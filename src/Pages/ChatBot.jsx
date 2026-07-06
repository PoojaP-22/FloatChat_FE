import React, { useState, useEffect, useRef } from 'react';
import { IoSend } from "react-icons/io5";
import { FaWater, FaDatabase, FaRobot, FaChartLine, FaTable, FaLightbulb, FaStar, FaRegStar, FaTimes, FaChevronDown, FaChevronUp, FaMapMarkerAlt, FaPlus, FaHistory, FaTrash, FaEllipsisV } from "react-icons/fa";
import { MdHealthAndSafety } from "react-icons/md";
import Plot from 'react-plotly.js';

const API_BASE_URL = 'http://localhost:8000/api/v1';

export const ChatBot = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [samples, setSamples] = useState([]);
  const [health, setHealth] = useState(null);
  const [showSamples, setShowSamples] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const [renamingSessionId, setRenamingSessionId] = useState(null);
  const [openSessionMenuId, setOpenSessionMenuId] = useState(null);
  const [openSessionMenuPos, setOpenSessionMenuPos] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const bottomInputRef = useRef(null);

  // Scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (hasStartedTyping) {
      bottomInputRef.current?.focus();
    }
  }, [hasStartedTyping]);

  // Load sample queries and health status on mount
  useEffect(() => {
    loadSamples();
    checkHealth();
    loadSessions();
  }, []);

  const getWelcomeMessage = (healthData) => ({
    type: 'bot',
    content: `Welcome to ARGO Ocean Analytics! I'm connected to ${healthData?.components?.database?.floats ?? 'available'} ocean floats with ${(healthData?.components?.database?.measurements ?? 0).toLocaleString()} measurements. Ask me anything about ocean temperature, salinity, or depth profiles!`,
    timestamp: new Date().toISOString()
  });

  const formatSessionTime = (timestamp) => {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return timestamp;
    }
  };

  const visibleSessions = sessions.filter((session) => {
    if (!sessionSearch.trim()) return true;
    const haystack = `${session.title || ''} ${session.last_message_preview || ''}`.toLowerCase();
    return haystack.includes(sessionSearch.trim().toLowerCase());
  });

  const safeParseJson = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  };

  const extractAssistantPayload = (message) => {
    const candidates = [
      message?.response_data,
      message?.chat_response,
      message?.payload,
      message?.metadata,
      message?.extra_data,
      message?.db_payload,
      message?.mongo_payload,
      message?.assistant_payload,
      message?.raw_response,
      safeParseJson(message?.content)
    ];

    const firstObject = candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item));
    const parsed = firstObject ? { ...firstObject } : {};

    const sqlResults = parsed.sql_data || parsed.sql_results || parsed.query_results || parsed.results || parsed.rows;

    return {
      query_id: message?.query_id || parsed.query_id,
      execution_time_ms: message?.execution_time_ms || parsed.execution_time_ms,
      text_response: parsed.text_response || message?.content,
      visualization: parsed.visualization || message?.visualization,
      data:
        parsed.data ||
        (Array.isArray(sqlResults) ? sqlResults : undefined) ||
        (Array.isArray(message?.data) ? message.data : undefined),
      numeric_summary: parsed.numeric_summary || message?.numeric_summary,
      analytics: parsed.analytics || message?.analytics,
      sql_query: parsed.sql_query || parsed.generated_sql || parsed.sql
    };
  };

  const normalizeHistoryMessages = (historyMessages = []) => {
    return historyMessages.map((message) => {
      if (message.role === 'assistant') {
        const assistantPayload = extractAssistantPayload(message);
        const content =
          assistantPayload.text_response ||
          message.content ||
          'Response loaded from session history.';

        const hasRichData = !!(
          assistantPayload.visualization ||
          (Array.isArray(assistantPayload.data) && assistantPayload.data.length > 0) ||
          assistantPayload.analytics ||
          assistantPayload.query_id
        );

        return {
          type: 'bot',
          content,
          timestamp: message.created_at,
          data: hasRichData ? assistantPayload : undefined
        };
      }

      return {
        type: 'user',
        content: message.content,
        timestamp: message.created_at
      };
    });
  };

  const loadSessionMessages = async (sessionId) => {
    if (!sessionId) return;
    setLoadingHistory(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/messages/`);
      if (!response.ok) throw new Error(`Failed to load session messages (${response.status})`);

      const payload = await response.json();
      const normalized = normalizeHistoryMessages(payload.messages || []);
      setCurrentSessionId(sessionId);
      setMessages(normalized);
      setHasStartedTyping(true);
      setShowSamples(false);
    } catch (error) {
      console.error('Failed to load session messages:', error);
      setMessages((prev) => prev.length ? prev : [{
        type: 'bot',
        content: `Could not load this session: ${error.message}`,
        isError: true,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadSessions = async (openLatest = true) => {
    setLoadingSessions(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chat/sessions/`);
      if (!response.ok) throw new Error(`Failed to load sessions (${response.status})`);

      const payload = await response.json();
      const nextSessions = payload.sessions || [];
      setSessions(nextSessions);

      if (openLatest && !currentSessionId && nextSessions.length > 0) {
        await loadSessionMessages(nextSessions[0].session_id);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoadingSessions(false);
    }
  };

  const createSession = async (title) => {
    setCreatingSession(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chat/sessions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title?.trim() || 'New Ocean Analysis'
        })
      });

      if (!response.ok) throw new Error(`Failed to create session (${response.status})`);

      const payload = await response.json();
      const sessionId = payload.session_id;
      if (!sessionId) throw new Error('Session id not returned by backend');

      const newSession = {
        session_id: sessionId,
        title: payload.title || 'New Ocean Analysis',
        pinned: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_message_preview: '',
        message_count: 0
      };

      setSessions((prev) => [newSession, ...prev.filter((s) => s.session_id !== sessionId)]);
      setCurrentSessionId(sessionId);
      return sessionId;
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    } finally {
      setCreatingSession(false);
    }
  };

  const startNewSession = async () => {
    try {
      const sessionId = await createSession('New Ocean Analysis');
      setCurrentSessionId(sessionId);
      setHasStartedTyping(false);
      setMessages([]);
      setShowSamples(false);
    } catch (error) {
      setMessages((prev) => [...prev, {
        type: 'bot',
        content: `Could not create a new session: ${error.message}`,
        isError: true,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const deleteSession = async (sessionId, event) => {
    event?.stopPropagation();
    if (!sessionId) return;

    try {
      setDeletingSessionId(sessionId);

      const response = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`Failed to delete session (${response.status})`);
      }

      const remainingSessions = sessions.filter((session) => session.session_id !== sessionId);
      setSessions(remainingSessions);

      if (currentSessionId === sessionId) {
        if (remainingSessions.length > 0) {
          await loadSessionMessages(remainingSessions[0].session_id);
        } else {
          setCurrentSessionId(null);
          setMessages([getWelcomeMessage(health)]);
          setShowSamples(true);
        }
      }
    } catch (error) {
      setMessages((prev) => [...prev, {
        type: 'bot',
        content: `Could not delete session: ${error.message}`,
        isError: true,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const checkHealth = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/health/`);
      const data = await response.json();
      setHealth(data);
      
      // Add welcome message based on health
      if (data.status === 'healthy') {
        setMessages((prev) => prev.length ? prev : [getWelcomeMessage(data)]);
      }
    } catch (error) {
      setHealth({ status: 'error' });
      setMessages((prev) => prev.length ? prev : [{
        type: 'bot',
        content: "Welcome! I'm having trouble connecting to the backend. Please ensure the API server is running at " + API_BASE_URL,
        isError: true,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const loadSamples = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/samples/`);
      const data = await response.json();
      setSamples(data.samples || []);
    } catch (error) {
      console.error('Failed to load samples:', error);
    }
  };

  const handleSampleClick = (query) => {
    setInput(query);
    setShowSamples(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userQuery = input.trim();
    if (!hasStartedTyping) {
      setHasStartedTyping(true);
    }
    setInput('');
    setShowSamples(false);

    // Add user message
    const userMessage = {
      type: 'user',
      content: userQuery,
      timestamp: new Date().toISOString()
    };

    // Add loading message
    const loadingMessage = {
      type: 'bot',
      content: 'Analyzing your query...',
      isLoading: true,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);
    setLoading(true);

    try {
      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = await createSession(userQuery.slice(0, 80));
      }

      const response = await fetch(`${API_BASE_URL}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userQuery,
          include_data: true,
          session_id: sessionId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      loadSessions(false);

      // Remove loading message and add response
      setMessages(prev => {
        const filtered = prev.filter(m => !m.isLoading);
        return [...filtered, {
          type: 'bot',
          content: data.text_response,
          data: data,
          userQuery,
          timestamp: new Date().toISOString()
        }];
      });

    } catch (error) {
      setMessages(prev => {
        const filtered = prev.filter(m => !m.isLoading);
        return [...filtered, {
          type: 'bot',
          content: `Error: ${error.message}. Please check if the backend server is running.`,
          isError: true,
          timestamp: new Date().toISOString()
        }];
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (queryId, rating) => {
    try {
      await fetch(`${API_BASE_URL}/chat/feedback/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query_id: queryId,
          rating
        })
      });
      
      // Update message to show feedback was received
      setMessages(prev => prev.map(m => 
        m.data?.query_id === queryId 
          ? { ...m, feedbackGiven: rating }
          : m
      ));
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    }
  };

  // Auto-generate visualization from raw data when backend doesn't provide one
  const generateAutoVisualization = (data, numericSummary) => {
    if (!data || data.length === 0) return null;

    const colors = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#14b8a6'];
    
    // Find numeric columns
    const numericColumns = Object.keys(data[0]).filter(key => 
      typeof data[0][key] === 'number' && 
      !['id', 'profile_id', 'float_id'].includes(key.toLowerCase())
    );

    // Find potential x-axis columns (time, date, or categorical)
    const timeColumn = Object.keys(data[0]).find(key => 
      key.toLowerCase().includes('time') || key.toLowerCase().includes('date')
    );
    
    const labelColumn = Object.keys(data[0]).find(key => 
      key.toLowerCase().includes('name') || key.toLowerCase().includes('platform') || key.toLowerCase().includes('number')
    );

    if (numericColumns.length === 0) return null;

    const baseLayout = {
      autosize: true,
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#94a3b8', family: 'Poppins, sans-serif' },
      margin: { t: 58, r: 10, b: 52, l: 46 },
      showlegend: true,
      legend: { orientation: 'h', y: -0.2, font: { color: '#94a3b8' } },
      xaxis: {
        domain: [0, 1],
        automargin: true,
        gridcolor: 'rgba(255,255,255,0.1)',
        linecolor: 'rgba(255,255,255,0.2)',
        tickfont: { color: '#94a3b8' }
      },
      yaxis: {
        domain: [0, 1],
        automargin: true,
        gridcolor: 'rgba(255,255,255,0.1)',
        linecolor: 'rgba(255,255,255,0.2)',
        tickfont: { color: '#94a3b8' }
      },
      title: {
        text: 'Data Visualization',
        font: { color: '#06b6d4', size: 16 },
        x: 0.5,
        xanchor: 'center',
        y: 0.99,
        yanchor: 'top',
        pad: { t: 6, b: 8 }
      },
      hoverlabel: {
        bgcolor: 'rgba(15, 23, 42, 0.95)',
        bordercolor: 'rgba(255,255,255,0.2)',
        font: { color: '#fff' }
      }
    };

    const config = {
      responsive: true,
      displayModeBar: 'hover',
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      displaylogo: false
    };

    // Determine chart type based on data characteristics
    const hasPressure = numericColumns.includes('pressure');
    const hasTemperature = numericColumns.includes('temperature');
    const hasSalinity = numericColumns.includes('salinity');

    let plotlyData = [];

    // Case 1: Depth profile data
    if (hasPressure && (hasTemperature || hasSalinity)) {
      const valueColumn = hasTemperature ? 'temperature' : 'salinity';
      const validPoints = data
        .map((row) => ({
          depth: Number(row.pressure),
          value: Number(row[valueColumn])
        }))
        .filter((point) => Number.isFinite(point.depth) && Number.isFinite(point.value));

      if (validPoints.length >= 2) {
        const groupedByDepth = validPoints.reduce((acc, point) => {
          const depthBucket = Math.round(point.depth);
          if (!acc[depthBucket]) {
            acc[depthBucket] = { depthSum: 0, valueSum: 0, count: 0 };
          }
          acc[depthBucket].depthSum += point.depth;
          acc[depthBucket].valueSum += point.value;
          acc[depthBucket].count += 1;
          return acc;
        }, {});

        const trendPoints = Object.values(groupedByDepth)
          .map((group) => ({
            depth: group.depthSum / group.count,
            value: group.valueSum / group.count
          }))
          .sort((a, b) => a.depth - b.depth);

        plotlyData = [
          {
            type: 'scatter',
            mode: 'markers',
            x: validPoints.map((point) => point.value),
            y: validPoints.map((point) => point.depth),
            marker: { color: 'rgba(6,182,212,0.45)', size: 7 },
            name: 'Samples',
            hovertemplate: `${valueColumn}: %{x:.2f}<br>Pressure: %{y:.1f} dbar<extra></extra>`
          },
          {
            type: 'scatter',
            mode: 'lines+markers',
            x: trendPoints.map((point) => point.value),
            y: trendPoints.map((point) => point.depth),
            marker: { color: colors[1], size: 8 },
            line: { color: colors[1], width: 3, shape: 'spline', smoothing: 0.6 },
            name: 'Avg trend',
            hovertemplate: `Avg ${valueColumn}: %{x:.2f}<br>Pressure: %{y:.1f} dbar<extra></extra>`
          }
        ];
      } else {
        plotlyData = [{
          type: 'scatter',
          mode: 'markers',
          x: validPoints.map((point) => point.value),
          y: validPoints.map((point) => point.depth),
          marker: { color: colors[0], size: 8 },
          name: valueColumn.charAt(0).toUpperCase() + valueColumn.slice(1)
        }];
      }

      baseLayout.yaxis.autorange = 'reversed';
      baseLayout.yaxis.title = { text: 'Pressure (dbar)', font: { color: '#94a3b8' } };
      baseLayout.xaxis.title = { text: valueColumn.charAt(0).toUpperCase() + valueColumn.slice(1), font: { color: '#94a3b8' } };
      baseLayout.title.text = 'Depth Profile';
    }
    // Case 2: Time series data
    else if (timeColumn) {
      numericColumns.slice(0, 3).forEach((col, idx) => {
        plotlyData.push({
          type: 'scatter',
          mode: 'lines+markers',
          x: data.map(d => d[timeColumn]),
          y: data.map(d => d[col]),
          name: col.replace(/_/g, ' '),
          line: { color: colors[idx % colors.length], width: 2 },
          marker: { color: colors[idx % colors.length], size: 5 }
        });
      });
      baseLayout.xaxis.title = { text: 'Time', font: { color: '#94a3b8' } };
      baseLayout.title.text = 'Time Series';
    }
    // Case 3: Scatter plot for correlation
    else if (numericColumns.length >= 2) {
      plotlyData = [{
        type: 'scatter',
        mode: 'markers',
        x: data.map(d => d[numericColumns[0]]),
        y: data.map(d => d[numericColumns[1]]),
        marker: { 
          color: numericColumns[2] ? data.map(d => d[numericColumns[2]]) : colors[0],
          size: 10,
          colorscale: numericColumns[2] ? 'Viridis' : undefined,
          showscale: !!numericColumns[2]
        },
        text: data.map((d, i) => `Point ${i + 1}`),
        hoverinfo: 'text+x+y'
      }];
      baseLayout.xaxis.title = { text: numericColumns[0].replace(/_/g, ' '), font: { color: '#94a3b8' } };
      baseLayout.yaxis.title = { text: numericColumns[1].replace(/_/g, ' '), font: { color: '#94a3b8' } };
      baseLayout.title.text = `${numericColumns[0]} vs ${numericColumns[1]}`;
    }
    // Case 4: Pie chart for compact category splits
    else if (labelColumn && numericColumns.length > 0 && data.length <= 10) {
      plotlyData = [{
        type: 'pie',
        labels: data.map(d => String(d[labelColumn] ?? 'Unknown')),
        values: data.map(d => Number(d[numericColumns[0]]) || 0),
        hole: 0.35,
        textinfo: 'label+percent',
        marker: {
          colors: colors,
          line: { color: 'rgba(15,23,42,0.8)', width: 1 }
        }
      }];
      baseLayout.title.text = `${numericColumns[0]} Share by ${labelColumn}`;
    }
    // Case 5: Bar chart for aggregated data
    else if (labelColumn && numericColumns.length > 0) {
      plotlyData = [{
        type: 'bar',
        x: data.map(d => d[labelColumn]),
        y: data.map(d => d[numericColumns[0]]),
        marker: { color: colors[0] }
      }];
      baseLayout.title.text = `${numericColumns[0]} by ${labelColumn}`;
    }
    else {
      // Generic line chart
      plotlyData = [{
        type: 'scatter',
        mode: 'lines+markers',
        y: data.map(d => d[numericColumns[0]]),
        x: data.map((_, i) => i + 1),
        marker: { color: colors[0], size: 6 },
        line: { color: colors[0], width: 2 },
        name: numericColumns[0]
      }];
      baseLayout.xaxis.title = { text: 'Index', font: { color: '#94a3b8' } };
      baseLayout.yaxis.title = { text: numericColumns[0], font: { color: '#94a3b8' } };
    }

    if (plotlyData.length === 0) return null;

    return (
      <div className="mt-4 flex h-[560px] flex-col rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900/80 via-slate-900/70 to-slate-800/70 p-3 shadow-lg shadow-cyan-900/20 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-2 text-cyan-400">
          <FaChartLine />
          <span className="font-medium">Auto-Generated Visualization</span>
        </div>
        <div className="min-h-0 flex-1">
          <Plot
            data={plotlyData}
            layout={baseLayout}
            config={config}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler={true}
          />
        </div>
      </div>
    );
  };

  const renderVisualization = (visualization, data = null, numericSummary = null) => {
    // If no backend visualization, try auto-generating one
    if (!visualization || !visualization.chart_data) {
      return generateAutoVisualization(data, numericSummary);
    }

    const { chart_type, chart_data, chart_options } = visualization;
    const colors = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#14b8a6'];

    // Common Plotly layout for dark theme
    const baseLayout = {
      autosize: true,
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#94a3b8', family: 'Poppins, sans-serif' },
      margin: { t: 58, r: 10, b: 50, l: 44 },
      showlegend: true,
      legend: { 
        orientation: 'h', 
        y: -0.15,
        font: { color: '#94a3b8' }
      },
      xaxis: {
        domain: [0, 1],
        automargin: true,
        gridcolor: 'rgba(255,255,255,0.1)',
        linecolor: 'rgba(255,255,255,0.2)',
        tickfont: { color: '#94a3b8' },
        title: { font: { color: '#94a3b8' } }
      },
      yaxis: {
        domain: [0, 1],
        automargin: true,
        gridcolor: 'rgba(255,255,255,0.1)',
        linecolor: 'rgba(255,255,255,0.2)',
        tickfont: { color: '#94a3b8' },
        title: { font: { color: '#94a3b8' } }
      },
      title: {
        text: chart_options?.plugins?.title?.text || '',
        font: { color: '#06b6d4', size: 16 },
        x: 0.5,
        xanchor: 'center',
        y: 0.99,
        yanchor: 'top',
        pad: { t: 6, b: 8 }
      },
      hoverlabel: {
        bgcolor: 'rgba(15, 23, 42, 0.95)',
        bordercolor: 'rgba(255,255,255,0.2)',
        font: { color: '#fff' }
      }
    };

    const config = {
      responsive: true,
      displayModeBar: 'hover',
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      displaylogo: false
    };

    // Transform Chart.js format to Plotly format
    const getPlotlyData = () => {
      const plotlyData = [];

      if (!chart_data.datasets) return plotlyData;

      chart_data.datasets.forEach((dataset, index) => {
        const trace = {
          name: dataset.label || `Series ${index + 1}`,
          marker: { color: dataset.borderColor || dataset.backgroundColor || colors[index % colors.length] },
          line: { color: dataset.borderColor || colors[index % colors.length], width: 2 }
        };

        // Handle different chart types
        switch (chart_type) {
          case 'line':
          case 'profile':
            trace.type = 'scatter';
            trace.mode = 'lines+markers';
            trace.x = chart_data.labels || dataset.data.map((_, i) => i);
            trace.y = dataset.data;
            trace.marker = { ...trace.marker, size: 6 };
            trace.fill = dataset.fill ? 'tozeroy' : 'none';
            trace.fillcolor = dataset.backgroundColor || `rgba(6, 182, 212, 0.1)`;
            break;

          case 'bar':
          case 'histogram':
            trace.type = 'bar';
            trace.x = chart_data.labels || dataset.data.map((_, i) => i);
            trace.y = dataset.data;
            trace.marker = { 
              color: dataset.backgroundColor || colors[index % colors.length],
              line: { color: dataset.borderColor || colors[index % colors.length], width: 1 }
            };
            break;

          case 'scatter':
            trace.type = 'scatter';
            trace.mode = 'markers';
            // Scatter data might be array of {x, y} objects
            if (Array.isArray(dataset.data) && dataset.data[0]?.x !== undefined) {
              trace.x = dataset.data.map(d => d.x);
              trace.y = dataset.data.map(d => d.y);
            } else {
              trace.x = chart_data.labels || dataset.data.map((_, i) => i);
              trace.y = dataset.data;
            }
            trace.marker = { 
              color: dataset.backgroundColor || colors[index % colors.length],
              size: 10,
              opacity: 0.7
            };
            break;

          case 'map':
            // Convert map payload to scatter graph (no geo-map rendering)
            if (chart_data.points) {
              trace.type = 'scatter';
              trace.mode = 'markers';
              trace.x = chart_data.points.map(p => p.lon);
              trace.y = chart_data.points.map(p => p.lat);
              trace.marker = {
                size: chart_data.points.map(p => Math.min(Math.max((p.value || 1) * 2, 6), 20)),
                color: chart_data.points.map(p => p.value),
                colorscale: 'Viridis',
                showscale: true,
                colorbar: { title: 'Value', tickfont: { color: '#94a3b8' } },
                opacity: 0.8
              };
              trace.text = chart_data.points.map(p => `Lat: ${p.lat}, Lon: ${p.lon}, Value: ${p.value}`);
              trace.hoverinfo = 'text+x+y';
            }
            break;

          case 'pie':
          case 'doughnut':
            trace.type = 'pie';
            trace.labels = chart_data.labels || dataset.data.map((_, i) => `Slice ${i + 1}`);
            trace.values = dataset.data;
            trace.hole = chart_type === 'doughnut' ? 0.45 : 0;
            trace.textinfo = 'label+percent';
            trace.marker = {
              colors: Array.isArray(dataset.backgroundColor)
                ? dataset.backgroundColor
                : colors,
              line: { color: 'rgba(15,23,42,0.8)', width: 1 }
            };
            break;

          case 'heatmap':
            trace.type = 'heatmap';
            trace.z = dataset.data;
            trace.x = chart_data.labels;
            trace.colorscale = 'Viridis';
            trace.showscale = true;
            break;

          default:
            trace.type = 'scatter';
            trace.mode = 'lines+markers';
            trace.x = chart_data.labels || dataset.data.map((_, i) => i);
            trace.y = dataset.data;
        }

        plotlyData.push(trace);
      });

      return plotlyData;
    };

    // Adjust layout for specific chart types
    const getLayout = () => {
      const layout = { ...baseLayout };

      if (chart_type === 'map' && chart_data.points) {
        layout.xaxis = { ...layout.xaxis, title: { text: 'Longitude', font: { color: '#94a3b8' } } };
        layout.yaxis = { ...layout.yaxis, title: { text: 'Latitude', font: { color: '#94a3b8' } } };
        layout.title = { ...layout.title, text: layout.title.text || 'Geospatial Scatter' };
        layout.height = 380;
      }

      if (chart_type === 'bar' || chart_type === 'histogram') {
        layout.barmode = 'group';
      }

      if (chart_type === 'pie' || chart_type === 'doughnut') {
        layout.xaxis = undefined;
        layout.yaxis = undefined;
      }

      if (chart_type === 'profile') {
        // For depth profiles, typically y-axis is inverted (depth increases downward)
        layout.yaxis = { ...layout.yaxis, autorange: 'reversed', title: 'Depth (m)' };
      }

      return layout;
    };

    const plotlyData = getPlotlyData();
    if (plotlyData.length === 0) return null;

    return (
      <div className="mt-4 flex h-[560px] flex-col rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900/80 via-slate-900/70 to-slate-800/70 p-3 shadow-lg shadow-cyan-900/20 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-2 text-cyan-400">
          <FaChartLine />
          <span className="font-medium">
            {chart_options?.plugins?.title?.text || 'Visualization'}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <Plot
            data={plotlyData}
            layout={getLayout()}
            config={config}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler={true}
          />
        </div>
      </div>
    );
  };

  const renderDataTable = (data, numericSummary) => {
    if (!data || data.length === 0) return null;

    const columns = Object.keys(data[0]);
    const displayData = data.slice(0, 10); // Show first 10 rows

    return (
      <div className="mt-4 bg-slate-900/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-cyan-400">
            <FaTable />
            <span className="font-medium">Data</span>
          </div>
          <span className="text-xs text-slate-400">
            Showing {displayData.length} of {numericSummary?.total_records || data.length} records
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                {columns.map(col => (
                  <th key={col} className="text-left py-2 px-3 text-slate-300 font-medium">
                    {col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayData.map((row, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  {columns.map(col => (
                    <td key={col} className="py-2 px-3 text-slate-300">
                      {typeof row[col] === 'number' 
                        ? row[col].toFixed(2) 
                        : row[col]?.toString().slice(0, 30) || '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderInsights = (analytics) => {
    if (!analytics) return null;

    // Parse insights - handle various formats from backend
    let insights = analytics.insights;
    
    // If insights is a string, try to parse it as JSON or use as-is
    if (typeof insights === 'string') {
      // Remove markdown code block formatting if present
      insights = insights.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      
      try {
        const parsed = JSON.parse(insights);
        // Handle { "insights": [...] } format
        if (parsed.insights) {
          insights = parsed.insights;
        } else if (Array.isArray(parsed)) {
          insights = parsed;
        } else {
          // It's an object, extract values
          insights = Object.entries(parsed).map(([key, value]) => `${key}: ${value}`);
        }
      } catch {
        // Not valid JSON, split by newlines or use as single insight
        insights = insights.split('\n').filter(s => s.trim());
      }
    }

    // If insights is not an array, wrap it
    if (!Array.isArray(insights)) {
      insights = insights ? [insights] : [];
    }

    // Transform each insight to string
    const formattedInsights = insights.map(insight => {
      if (typeof insight === 'string') {
        return insight;
      }
      if (typeof insight === 'object' && insight !== null) {
        // Handle { "temperature": "description" } format
        return Object.entries(insight)
          .map(([key, value]) => `**${key.charAt(0).toUpperCase() + key.slice(1)}**: ${value}`)
          .join(' ');
      }
      return String(insight);
    }).filter(s => s && s.trim());

    if (formattedInsights.length === 0) return null;

    // Parse trends similarly
    let trends = analytics.trends;
    if (typeof trends === 'object' && trends !== null) {
      trends = Object.values(trends).join('; ');
    }

    // Parse recommendations similarly
    let recommendations = analytics.recommendations;
    if (typeof recommendations === 'object' && recommendations !== null) {
      recommendations = Object.values(recommendations).join('; ');
    }

    return (
      <div className="mt-4 bg-gradient-to-r from-purple-900/30 to-cyan-900/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3 text-yellow-400">
          <FaLightbulb />
          <span className="font-medium">Insights</span>
        </div>
        <ul className="space-y-3">
          {formattedInsights.map((insight, i) => (
            <li key={i} className="flex items-start gap-2 text-slate-300 text-sm">
              <span className="text-cyan-400 mt-0.5">•</span>
              <span dangerouslySetInnerHTML={{ 
                __html: insight
                  .replace(/\*\*(.*?)\*\*/g, '<strong class="text-cyan-300">$1</strong>')
                  .replace(/`(.*?)`/g, '<code class="bg-slate-700 px-1 rounded">$1</code>')
              }} />
            </li>
          ))}
        </ul>
        {trends && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <span className="text-purple-400 text-sm font-medium">Trend: </span>
            <span className="text-slate-300 text-sm">{trends}</span>
          </div>
        )}
        {recommendations && (
          <div className="mt-2">
            <span className="text-green-400 text-sm font-medium">Recommendation: </span>
            <span className="text-slate-300 text-sm">{recommendations}</span>
          </div>
        )}
      </div>
    );
  };

  const renderFeedback = (message) => {
    if (!message.data?.query_id) return null;

    return (
      <div className="mt-3 pt-3 border-t border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Rate this response:</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(rating => (
              <button
                key={rating}
                onClick={() => handleFeedback(message.data.query_id, rating)}
                className={`p-1 transition-colors ${
                  message.feedbackGiven === rating 
                    ? 'text-yellow-400' 
                    : 'text-slate-500 hover:text-yellow-400'
                }`}
                disabled={message.feedbackGiven}
              >
                {message.feedbackGiven >= rating ? <FaStar /> : <FaRegStar />}
              </button>
            ))}
          </div>
          {message.feedbackGiven && (
            <span className="text-xs text-green-400">Thanks for your feedback!</span>
          )}
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
          <span>Query ID: {message.data.query_id}</span>
          <span>Time: {message.data.execution_time_ms?.toFixed(0)}ms</span>
        </div>
      </div>
    );
  };

  const shouldRenderVisualization = (message) => {
    const responseData = message?.data;
    if (!responseData) return false;

    const rows = Array.isArray(responseData.data) ? responseData.data : [];
    const backendVisualization = responseData.visualization?.chart_data;
    if (rows.length === 0) {
      return !!backendVisualization;
    }

    const sampleRow = rows[0] || {};
    const numericColumns = Object.keys(sampleRow).filter((key) => {
      const value = sampleRow[key];
      return typeof value === 'number' && !['id', 'profile_id', 'float_id'].includes(key.toLowerCase());
    });

    const chartType = (responseData.visualization?.chart_type || '').toLowerCase();
    const chartableType = ['line', 'bar', 'scatter', 'pie', 'doughnut', 'histogram', 'profile', 'heatmap', 'map'];

    const userQueryText = (message.userQuery || '').toLowerCase();
    const botText = (message.content || '').toLowerCase();
    const intentText = `${userQueryText} ${botText}`;

    const visualizationIntentPattern =
      /\b(plot|chart|graph|visuali[sz]e|show\s+me|trend|distribution|compare|comparison|correlation|relationship|breakdown|percentage|share|over\s+time|vs\b|versus|scatter|bar|pie|histogram|line\s*chart|profile)\b/;
    const analyticalPattern =
      /\b(trend|pattern|variation|increase|decrease|distribution|relationship|correlation|compare|forecast)\b/;

    const hasVisualizationIntent = visualizationIntentPattern.test(intentText);
    const looksAnalytical = analyticalPattern.test(botText);

    const hasChartableData =
      (numericColumns.length >= 2 && rows.length >= 3) ||
      (numericColumns.length >= 1 && rows.length >= 6);

    if (hasVisualizationIntent) {
      return hasChartableData || !!backendVisualization;
    }

    if (backendVisualization && chartableType.includes(chartType)) {
      return hasChartableData || looksAnalytical;
    }

    return looksAnalytical && hasChartableData;
  };

  const formatCoordinate = (value, positiveLabel, negativeLabel) => {
    if (value === null || value === undefined || value === '') return null;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return null;
    const direction = numericValue >= 0 ? positiveLabel : negativeLabel;
    return `${Math.abs(numericValue).toFixed(3)}° ${direction}`;
  };

  const extractFloatSources = (data) => {
    if (!Array.isArray(data) || data.length === 0) return [];

    const pickValue = (row, keys) => {
      for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
          return row[key];
        }
      }
      return null;
    };

    const sourceMap = new Map();

    const updateRange = (source, fieldName, value) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return;

      if (source[`${fieldName}Min`] === null || numericValue < source[`${fieldName}Min`]) {
        source[`${fieldName}Min`] = numericValue;
      }
      if (source[`${fieldName}Max`] === null || numericValue > source[`${fieldName}Max`]) {
        source[`${fieldName}Max`] = numericValue;
      }
    };

    data.forEach((row, index) => {
      const floatIdRaw = pickValue(row, ['float_id', 'platform_number', 'wmo', 'wmo_id', 'float', 'argo_id', 'platform']);
      const fallbackId = 'Unknown Float';
      const floatId = String(floatIdRaw ?? fallbackId);
      const floatName = pickValue(row, ['float_name', 'platform_name', 'name', 'float_label', 'platform_label']);

      const latitude = pickValue(row, ['latitude', 'lat']);
      const longitude = pickValue(row, ['longitude', 'lon', 'long']);
      const locationName = pickValue(row, ['location', 'region', 'ocean', 'sea', 'basin', 'area']);
      const observationTime = pickValue(row, ['time', 'date', 'datetime', 'timestamp', 'observation_time']);

      if (!sourceMap.has(floatId)) {
        sourceMap.set(floatId, {
          id: floatId,
          name: null,
          count: 0,
          latitude: null,
          longitude: null,
          locationName: null,
          lastObservationTime: null,
          pressureMin: null,
          pressureMax: null,
          temperatureMin: null,
          temperatureMax: null,
          salinityMin: null,
          salinityMax: null
        });
      }

      const source = sourceMap.get(floatId);
      source.count += 1;

      if (floatName) source.name = String(floatName);
      if (latitude !== null && latitude !== undefined) source.latitude = latitude;
      if (longitude !== null && longitude !== undefined) source.longitude = longitude;
      if (locationName) source.locationName = String(locationName);
      if (observationTime) source.lastObservationTime = String(observationTime);

      updateRange(source, 'pressure', row.pressure);
      updateRange(source, 'temperature', row.temperature);
      updateRange(source, 'salinity', row.salinity);
    });

    return Array.from(sourceMap.values())
      .sort((a, b) => b.count - a.count);
  };

  const extractFloatRecords = (data) => {
    if (!Array.isArray(data) || data.length === 0) return [];

    const pickValue = (row, keys) => {
      for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
          return row[key];
        }
      }
      return null;
    };

    return data.map((row, index) => ({
      key: `record-${index + 1}`,
      index: index + 1,
      id: String(pickValue(row, ['float_id', 'platform_number', 'wmo', 'wmo_id', 'float', 'argo_id', 'platform']) ?? 'Unknown Float'),
      name: String(pickValue(row, ['float_name', 'platform_name', 'name', 'float_label', 'platform_label']) ?? 'Unnamed float'),
      latitude: pickValue(row, ['latitude', 'lat']),
      longitude: pickValue(row, ['longitude', 'lon', 'long']),
      locationName: pickValue(row, ['location', 'region', 'ocean', 'sea', 'basin', 'area']),
      time: pickValue(row, ['time', 'date', 'datetime', 'timestamp', 'observation_time']),
      raw: row
    }));
  };

  const hasFloatMetadata = (data) => {
    if (!Array.isArray(data) || data.length === 0) return false;
    return data.some((row) => {
      const hasId = row.float_id || row.platform_number || row.wmo || row.wmo_id || row.float || row.argo_id || row.platform;
      const hasName = row.float_name || row.platform_name || row.name || row.float_label || row.platform_label;
      const hasCoords =
        row.latitude !== undefined || row.lat !== undefined || row.longitude !== undefined || row.lon !== undefined || row.long !== undefined;
      const hasLocation = row.location || row.region || row.ocean || row.sea || row.basin || row.area;
      return !!(hasId || hasName || hasCoords || hasLocation);
    });
  };

  const formatRange = (min, max, unit = '') => {
    if (min === null || max === null) return 'N/A';
    const suffix = unit ? ` ${unit}` : '';
    return `${min.toFixed(2)} - ${max.toFixed(2)}${suffix}`;
  };

  const renderFloatSourcePanel = (data) => {
    const sources = extractFloatSources(data);
    const records = extractFloatRecords(data);
    const metadataAvailable = hasFloatMetadata(data);
    const primarySource = sources[0] || null;

    return (
      <div className="mt-4 flex h-[560px] min-h-[560px] max-h-[560px] flex-col overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-900/90 via-slate-900/75 to-emerald-950/40 p-4 shadow-lg shadow-emerald-900/20">
        <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-2 text-emerald-300">
          <FaMapMarkerAlt />
          <span className="font-medium">Float Source Details</span>
        </div>

        {records.length === 0 ? (
          <p className="text-sm text-slate-400">No float metadata available for this query result.</p>
        ) : !metadataAvailable ? (
          <>
            <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-900/10 p-3 text-sm text-slate-300">
              <div className="font-semibold text-amber-300">Float metadata not present in this query result</div>
              <div className="mt-2 text-xs leading-relaxed text-slate-300">
                This response is aggregated, so float name and coordinates were not returned by the backend.
              </div>
            </div>
            <div className="mb-2 text-xs text-slate-400">
              Records: <span className="font-semibold text-cyan-300">{records.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {records.map((record) => {
                const importantPairs = Object.entries(record.raw || {})
                  .filter(([key, value]) => !['id', 'profile_id'].includes(String(key).toLowerCase()))
                  .filter(([, value]) => value !== null && value !== undefined && value !== '')
                  .slice(0, 4);

                return (
                  <div key={record.key} className="rounded-xl border border-white/10 bg-slate-800/60 p-3">
                    <div className="text-[11px] text-slate-400">Record #{record.index}</div>
                    <div className="mt-1 space-y-1 text-xs text-slate-300">
                      {importantPairs.length > 0 ? importantPairs.map(([key, value]) => (
                        <div key={key}>
                          <span className="text-slate-400">{String(key).replace(/_/g, ' ')}:</span>{' '}
                          <span>{String(value)}</span>
                        </div>
                      )) : (
                        <div className="text-slate-500">No detailed fields available</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 text-xs text-slate-400">
              Sources detected: <span className="font-semibold text-emerald-300">{sources.length}</span>
              <span className="mx-1 text-slate-500">|</span>
              Records: <span className="font-semibold text-cyan-300">{records.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {records.map((record) => {
                const latText = formatCoordinate(record.latitude, 'N', 'S');
                const lonText = formatCoordinate(record.longitude, 'E', 'W');

                return (
                  <div key={record.key} className="rounded-xl border border-white/10 bg-slate-800/60 p-3">
                    <div className="text-[11px] text-slate-400">Record #{record.index}</div>
                    <div className="text-sm font-semibold text-cyan-300">{record.id}</div>
                    <div className="mt-0.5 text-xs text-emerald-300/90">{record.name}</div>
                    {record.locationName && (
                      <div className="mt-1 text-xs text-slate-300">Area: {record.locationName}</div>
                    )}
                    {(latText || lonText) ? (
                      <div className="mt-1 text-xs text-slate-400">
                        {latText || 'Lat N/A'} | {lonText || 'Lon N/A'}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500">Coordinates unavailable</div>
                    )}
                    <div className="mt-1 text-xs text-slate-500">{record.time || 'Time unavailable'}</div>
                  </div>
                );
              })}
            </div>

            {primarySource && (
              <div className="mt-3 rounded-xl border border-white/10 bg-slate-800/70 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Primary Float Snapshot</div>
                <div className="mt-2 text-sm font-semibold text-cyan-300">{primarySource.id}</div>
                <div className="text-xs text-slate-300">{primarySource.name || 'Unnamed float'}</div>

                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-300">
                  <div className="rounded-lg bg-slate-900/50 p-2">Temperature: {formatRange(primarySource.temperatureMin, primarySource.temperatureMax, 'C')}</div>
                  <div className="rounded-lg bg-slate-900/50 p-2">Salinity: {formatRange(primarySource.salinityMin, primarySource.salinityMax, 'psu')}</div>
                  <div className="rounded-lg bg-slate-900/50 p-2">Pressure: {formatRange(primarySource.pressureMin, primarySource.pressureMax, 'dbar')}</div>
                  <div className="rounded-lg bg-slate-900/50 p-2">Last observation: {primarySource.lastObservationTime || 'N/A'}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const renderMessage = (message, index) => {
    if (message.type === 'user') {
      return (
        <div key={index} className="flex justify-end mb-4">
          <div className="max-w-[80%] bg-cyan-600 text-white p-4 rounded-2xl rounded-tr-sm">
            {message.content}
          </div>
        </div>
      );
    }

    const showVisualization = shouldRenderVisualization(message);

    // Bot message
    return (
      <div key={index} className="flex justify-start mb-4">
        <div className={`max-w-[90%] p-4 rounded-2xl rounded-tl-sm ${
          message.isError 
            ? 'bg-red-900/30 border border-red-500/30' 
            : message.isLoading
            ? 'bg-slate-800/50'
            : 'bg-slate-800/70'
        }`}>
          {/* Main text response */}
          <div className="text-white">
            {message.isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                <span className="ml-2 text-slate-300">{message.content}</span>
              </div>
            ) : (
              message.content
            )}
          </div>

          {/* Rich content for successful responses */}
          {message.data && !message.isError && (
            <>
              {/* Visualization */}
              {showVisualization && (
                <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  {renderVisualization(message.data.visualization, message.data.data, message.data.numeric_summary)}
                  {renderFloatSourcePanel(message.data.data)}
                </div>
              )}
              
              {/* Insights */}
              {renderInsights(message.data.analytics)}
              
              {/* Data Table */}
              {renderDataTable(message.data.data, message.data.numeric_summary)}
              
              {/* Feedback */}
              {renderFeedback(message)}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell relative h-screen w-screen overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative h-full w-full flex flex-col">
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden bg-slate-900/30 backdrop-blur-sm">
          {/* Fixed Sessions Sidebar */}
          <div className={`glass-panel hidden h-full flex-none border-r border-white/10 p-2 pt-4 transition-all duration-300 ease-out lg:flex lg:flex-col ${isSidebarCollapsed ? 'w-20 min-w-20 max-w-20' : 'w-[246px] min-w-[246px] max-w-[246px]'}`}>
            <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} gap-2 pb-2`}> 
              {!isSidebarCollapsed && (
                <div className="flex items-center gap-2 text-slate-200">
                  <div className="rounded-full bg-cyan-500/15 p-1.5">
                    <FaWater className="text-[17px] text-cyan-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-extrabold tracking-wide text-slate-50">FLOATCHAT</div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/70 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                title={isSidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
              >
                <span className="flex h-4 w-4 overflow-hidden rounded-sm border border-current">
                  <span className="h-full w-1/2 border-r border-current bg-transparent" />
                  <span className="h-full w-1/2 bg-transparent" />
                </span>
              </button>
            </div>

            {!isSidebarCollapsed && (
              <div className="flex min-h-0 flex-1 flex-col">
                <button
                  onClick={startNewSession}
                  disabled={creatingSession}
                  className="mb-3 flex h-10 w-full items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 text-[13px] font-medium text-slate-100 transition-colors hover:bg-slate-800/70 disabled:opacity-60"
                >
                  <span className="text-[14px] leading-none">+</span>
                  <span>New chat</span>
                </button>

                <div className="mb-3">
                  <input
                    type="text"
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    placeholder="Search chats"
                    className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-[13px] text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50"
                  />
                </div>

                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Recents</div>

                {loadingSessions ? (
                  <div className="rounded-lg px-2 py-2 text-xs text-slate-400">Loading sessions...</div>
                ) : visibleSessions.length === 0 ? (
                  <div className="rounded-lg px-2 py-2 text-xs text-slate-400">No chats yet.</div>
                ) : (
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 no-scrollbar">
                    {visibleSessions.map((session) => (
                      <div
                        key={session.session_id}
                        className={`session-menu-wrap relative flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${
                          currentSessionId === session.session_id
                            ? 'bg-slate-700/80 text-slate-100'
                            : 'text-slate-300 hover:bg-slate-800/70'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => loadSessionMessages(session.session_id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <FaHistory className="shrink-0 text-[12px] text-slate-400" />
                          <span className="truncate pr-8 text-[13px]">{session.title || 'New chat'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            setOpenSessionMenuId((prev) => (prev === session.session_id ? null : session.session_id));
                            setOpenSessionMenuPos((prev) => (
                              openSessionMenuId === session.session_id
                                ? null
                                : {
                                    top: rect.bottom + 6,
                                    left: rect.right - 112
                                  }
                            ));
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                          title="Chat actions"
                          disabled={deletingSessionId === session.session_id || renamingSessionId === session.session_id}
                        >
                          <FaEllipsisV className="text-xs" />
                        </button>

                        {openSessionMenuId === session.session_id && openSessionMenuPos && (
                          <div
                            className="fixed z-50 w-28 overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-lg"
                            style={{ top: `${openSessionMenuPos.top}px`, left: `${openSessionMenuPos.left}px` }}
                          >
                            <button
                              type="button"
                              onClick={(event) => renameSession(session.session_id, event)}
                              className="block w-full px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:bg-slate-800"
                              disabled={renamingSessionId === session.session_id}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={(event) => deleteSession(session.session_id, event)}
                              className="block w-full px-3 py-2 text-left text-xs text-red-300 transition-colors hover:bg-red-900/30"
                              disabled={deletingSessionId === session.session_id}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col min-h-0">
            {/* Header */}
            <div className="glass-panel sticky top-0 z-20 shrink-0 px-4 py-3 border-b border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-xl bg-cyan-500/20 p-2">
                    <FaWater className="text-[22px] text-cyan-400" />
                  </div>
                  <div>
                    <h1 className="text-[18px] font-semibold leading-tight text-white">ARGO Ocean Analytics</h1>
                    <p className="text-[12px] leading-tight text-slate-400">AI-Powered Ocean Data Analysis</p>
                  </div>
                </div>
                
                {/* Health Status */}
                <div className="flex items-center gap-2">
                  <MdHealthAndSafety className={`text-xl ${
                    health?.status === 'healthy' ? 'text-green-400' : 
                    health?.status === 'error' ? 'text-red-400' : 'text-yellow-400'
                  }`} />
                  <div className="text-right">
                    <div className={`text-sm font-medium ${
                      health?.status === 'healthy' ? 'text-green-400' : 
                      health?.status === 'error' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {health?.status === 'healthy' ? 'Connected' : 
                       health?.status === 'error' ? 'Disconnected' : 'Loading...'}
                    </div>
                    {health?.components?.database && (
                      <div className="text-xs text-slate-400">
                        <FaDatabase className="inline mr-1" />
                        {health.components.database.floats} floats | {health.components.database.measurements?.toLocaleString()} measurements
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-3 no-scrollbar">
              {loadingHistory && (
                <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-sm text-cyan-300">
                  Loading conversation history...
                </div>
              )}

              {!hasStartedTyping && !loading && (
                <div className="flex h-full w-full flex-col items-center justify-center text-center">
                  <div className="hero-orb mb-5 flex h-20 w-20 items-center justify-center">
                    <div className="ai-sphere-glow" />
                    <div className="ai-sphere h-16 w-16" />
                  </div>
                  <h2 className="text-3xl font-semibold text-slate-100">Good Evening, FLOATCHAT.</h2>
                  <p className="mt-2 text-lg text-slate-300">Can I help you with anything?</p>

                  <form onSubmit={handleSubmit} className="mt-8 w-full max-w-3xl">
                    <div className="glass-panel rounded-2xl p-4">
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Message FloatChat..."
                        className="glass-input w-full rounded-xl px-4 py-4 text-left text-[16px] text-slate-200 placeholder-slate-500 focus:outline-none"
                      />
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleSampleClick('Show temperature trends for the last 30 days')}
                          className="chip-button flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/50 px-3 py-2 text-xs text-slate-200 transition-colors hover:bg-slate-800/60"
                        >
                          <FaChartLine className="text-[13px] text-cyan-300" />
                          Create a chart
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSampleClick('Summarize salinity measurements by depth')}
                          className="chip-button flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/50 px-3 py-2 text-xs text-slate-200 transition-colors hover:bg-slate-800/60"
                        >
                          <FaTable className="text-[13px] text-cyan-300" />
                          Summarize data
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSampleClick('Find recent anomalies in float measurements')}
                          className="chip-button flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/50 px-3 py-2 text-xs text-slate-200 transition-colors hover:bg-slate-800/60"
                        >
                          <FaStar className="text-[13px] text-cyan-300" />
                          Spot anomalies
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="mt-6 grid w-full max-w-4xl gap-4 md:grid-cols-3">
                    <div className="glass-card rounded-xl p-4 text-left">
                      <h3 className="text-sm font-semibold text-slate-100">Float Insights</h3>
                      <p className="mt-2 text-xs text-slate-400">Get quick summaries for a float or region in seconds.</p>
                    </div>
                    <div className="glass-card rounded-xl p-4 text-left">
                      <h3 className="text-sm font-semibold text-slate-100">Temperature Profiles</h3>
                      <p className="mt-2 text-xs text-slate-400">Compare surface and deep-water temperature trends.</p>
                    </div>
                    <div className="glass-card rounded-xl p-4 text-left">
                      <h3 className="text-sm font-semibold text-slate-100">Salinity Trends</h3>
                      <p className="mt-2 text-xs text-slate-400">Track salinity shifts over time without leaving chat.</p>
                    </div>
                  </div>
                </div>
              )}
              
              {hasStartedTyping && (
                <>
                  {messages.map((message, index) => renderMessage(message, index))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            <form
              onSubmit={handleSubmit}
              className={`mt-auto px-4 py-3 transition-all duration-300 ${hasStartedTyping ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 -translate-y-2'}`}
            >
              <div className="flex items-center gap-3">
                <input
                  ref={bottomInputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about ocean data... (e.g., 'What is the average temperature in the Indian Ocean?')"
                  className="neon-input-field flex-1 rounded-full border border-slate-700/60 bg-slate-900/60 px-6 py-3.5 text-[16px] shadow-lg shadow-slate-900/30 focus:outline-none"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="neon-send flex h-11 w-11 items-center justify-center rounded-lg text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IoSend size={20} />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};