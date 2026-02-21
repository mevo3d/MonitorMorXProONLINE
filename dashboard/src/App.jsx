import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
    LayoutDashboard, Search, Bot, Settings, RefreshCw, Radio, Twitter, Globe, Clock, MessageSquare, ChevronRight, Zap, ExternalLink, Play, Edit, Plus, X, Save, ArrowLeft, Download
} from 'lucide-react';
import dayjs from 'dayjs';
import 'dayjs/locale/es';

dayjs.locale('es');

function App() {
    const [userStats, setUserStats] = useState(null);

    useEffect(() => {
        fetchStats();
        fetchConfig();
        const interval = setInterval(fetchLogs, 3000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (activeTab === 'search') {
            fetchTweets(filterMode); // Mantener filtro si existe
        }
    }, [activeTab]);

    useEffect(() => {
        if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }, [logs]);

    const fetchStats = async () => {
        try {
            const res = await axios.get('/api/stats');
            setStats(res.data);
            setLoading(false);
        } catch (error) {
            console.error("Error fetching stats:", error);
            setLoading(false);
        }
    };

    const fetchConfig = async () => {
        try {
            const res = await axios.get('/api/config');
            setKeywords(res.data.categorias || {});
            setTotalKeywords(res.data.totalKeywords || 0);
        } catch (e) { console.error(e); }
    };

    const fetchLogs = async () => {
        try {
            const res = await axios.get('/api/logs');
            setLogs(res.data.logs);
        } catch (e) { /* silent */ }
    };

    const fetchTweets = async (filter = null) => {
        setFeedLoading(true);
        setFilterMode(filter);
        setUserStats(null); // Reset user stats

        // Si se activa un filtro desde el dashboard, cambiamos al tab de búsqueda automáticamente
        if (filter && activeTab !== 'search') setActiveTab('search');

        let url = '/api/tweets?limit=50';
        if (filter?.type === 'handle') {
            url += `&handle=${encodeURIComponent(filter.value)}`;
            fetchUserStats(filter.value);
        }
        if (filter?.type === 'keyword') url += `&keyword=${encodeURIComponent(filter.value)}`;

        try {
            const res = await axios.get(url);
            setTweets(res.data);
        } catch (e) {
            console.error("Error fetching tweets:", e);
        }
        setFeedLoading(false);
    };

    const fetchUserStats = async (handle) => {
        try {
            const res = await axios.get(`/api/stats/user/${encodeURIComponent(handle)}`);
            setUserStats(res.data);
        } catch (e) {
            console.error("Error fetching user stats:", e);
        }
    };

    const saveApiKey = async () => {
        try {
            await axios.post('/api/config/save', { openaiKey: apiKey });
            alert('API Key guardada correctamente');
            setApiKey('');
        } catch (e) {
            alert('Error guardando API Key: ' + e.message);
        }
    };

    const saveKeywords = async () => {
        try {
            const res = await axios.post('/api/config/keywords', { categorias: keywords });
            if (res.data.success) {
                setTotalKeywords(res.data.totalKeywords);
                alert('Palabras clave actualizadas correctamente');
                fetchStats(); // Refrescar stats con nuevas keywords
            }
        } catch (e) {
            alert('Error guardando keywords: ' + e.message);
        }
    };

    const handleEditCategory = (cat) => {
        setEditingCategory(cat);
        setTempKeywords(keywords[cat].join(', '));
    };

    const saveCategoryEdit = () => {
        const list = tempKeywords.split(',').map(s => s.trim()).filter(s => s.length > 0);
        setKeywords(prev => ({ ...prev, [editingCategory]: list }));
        setEditingCategory(null);
    };

    const sendAiMessage = async () => {
        if (!userPrompt.trim()) return;
        const newMsg = { role: 'user', content: userPrompt };
        setChatMessages(prev => [...prev, newMsg]);
        setUserPrompt('');
        setAiLoading(true);
        try {
            const res = await axios.post('/api/ai', { prompt: newMsg.content });
            setChatMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
        } catch (e) {
            setChatMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error al conectar con la IA. Verifica tu API Key.' }]);
        }
        setAiLoading(false);
    };

    const NavButton = ({ id, icon: Icon, label }) => (
        <button
            onClick={() => { setActiveTab(id); if (id !== 'search') setFilterMode(null); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 group cursor-pointer
        ${activeTab === id
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
        >
            <Icon size={20} className={activeTab === id ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'} />
            {label}
            {activeTab === id && <ChevronRight size={16} className="ml-auto opacity-50" />}
        </button>
    );

    // ====== DASHBOARD ======
    const renderDashboard = () => {
        if (loading) return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
        if (!stats) return <div className="p-10 text-center text-red-500 bg-red-50 rounded-xl border border-red-100">Error cargando estadísticas. Verifica el servidor.</div>;

        const dataPoderes = [
            { name: 'Legislativo', value: stats.conteoPorPoder?.legislativo || 0, color: '#F59E0B' },
            { name: 'Gobierno', value: stats.conteoPorPoder?.gobierno || 0, color: '#10B981' },
            { name: 'Judicial', value: stats.conteoPorPoder?.judicial || 0, color: '#3B82F6' },
            { name: 'Otros', value: stats.conteoPorPoder?.otros || 0, color: '#94A3B8' }
        ].filter(d => d.value > 0);

        return (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-lg transition-all duration-300 group cursor-default">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-blue-50 rounded-xl group-hover:bg-blue-100 transition-colors">
                                <Twitter className="text-blue-600" size={24} />
                            </div>
                        </div>
                        <h3 className="text-slate-500 text-sm font-medium mb-1">Total Tweets</h3>
                        <p className="text-3xl font-bold text-slate-800">{stats.totalTweets?.toLocaleString()}</p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-lg transition-all duration-300 group cursor-default">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-indigo-50 rounded-xl group-hover:bg-indigo-100 transition-colors">
                                <Globe className="text-indigo-600" size={24} />
                            </div>
                        </div>
                        <h3 className="text-slate-500 text-sm font-medium mb-1">Medios Únicos</h3>
                        <p className="text-3xl font-bold text-slate-800">{stats.totalMedios}</p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-lg transition-all duration-300 group cursor-default">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-purple-50 rounded-xl group-hover:bg-purple-100 transition-colors">
                                <Clock className="text-purple-600" size={24} />
                            </div>
                        </div>
                        <h3 className="text-slate-500 text-sm font-medium mb-1">Hora Pico</h3>
                        <p className="text-3xl font-bold text-slate-800">{stats.horasMasActivas?.[0]?.hora || 'N/A'}</p>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-2xl shadow-lg border border-slate-700 text-white cursor-default">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm">
                                <Radio className="text-white" size={24} />
                            </div>
                            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                        </div>
                        <h3 className="text-slate-400 text-sm font-medium mb-1">Sistema</h3>
                        <p className="text-lg font-bold">En Línea</p>
                    </div>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Distribución por Poder */}
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
                        <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                            <span className="w-1 h-6 bg-amber-500 rounded-full"></span>
                            Distribución por Poder
                        </h3>
                        <p className="text-xs text-slate-500 mb-6">Basado en las palabras clave configuradas vs. contenido de los tweets</p>
                        <div className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={dataPoderes} cx="50%" cy="50%" innerRadius={80} outerRadius={100} paddingAngle={5} dataKey="value" stroke="none">
                                        {dataPoderes.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                                    <Legend iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Top Medios */}
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
                        <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                            <span className="w-1 h-6 bg-indigo-500 rounded-full"></span>
                            Top 10 Usuarios Más Activos
                        </h3>
                        <p className="text-xs text-slate-500 mb-6">Haz click en un usuario para ver sus tweets</p>
                        <div className="space-y-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                            {stats.topMedios?.map((medio, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => fetchTweets({ type: 'handle', value: medio.handle })}
                                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-blue-50 hover:border-blue-200 border border-transparent transition-all group cursor-pointer"
                                >
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0 group-hover:scale-110 transition-transform">
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-slate-800 text-sm truncate group-hover:text-blue-700">{medio.nombre}</p>
                                        <p className="text-xs text-slate-500 group-hover:text-blue-500 font-medium">{medio.handle}</p>
                                        {medio.temas && medio.temas.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {medio.temas.map((tema, i) => (
                                                    <span key={i} className="text-[10px] bg-white border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded-md">{tema}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <p className="text-lg font-bold text-slate-800 group-hover:text-blue-700">{medio.tweets}</p>
                                        <ArrowRightIcon className="inline opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity ml-1" size={14} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Palabras Clave */}
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Tendencias Detectadas</h3>
                    <p className="text-xs text-slate-500 mb-4">Haz click para ver tweets que mencionan estas palabras</p>
                    <div className="flex flex-wrap gap-3">
                        {stats.palabrasClaveTop?.map((pc, idx) => (
                            <button
                                key={idx}
                                onClick={() => fetchTweets({ type: 'keyword', value: pc.palabra })}
                                className="group flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-blue-600 hover:text-white border border-slate-100 hover:border-blue-600 rounded-xl text-sm font-medium text-slate-600 transition-all cursor-pointer shadow-sm hover:shadow-lg hover:-translate-y-0.5"
                            >
                                {pc.palabra}
                                <span className="bg-slate-200 group-hover:bg-white/20 text-slate-600 group-hover:text-white px-2 py-0.5 rounded-md text-xs font-bold transition-colors">
                                    {pc.count}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    // ====== FEED ======
    const renderFeed = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* User Details Dashboard (Si hay userStats) */}
            {userStats && filterMode?.type === 'handle' && (
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-lg mb-6 card-highlight relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-20 -mt-20 blur-3xl"></div>
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div>
                            <div className="flex items-center gap-4 mb-2">
                                <div className="w-16 h-16 rounded-full bg-white text-slate-900 flex items-center justify-center font-bold text-2xl shadow-xl border-4 border-slate-700/50">
                                    {(filterMode.value || '?').replace('@', '').substring(0, 2).toUpperCase()}
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold">{filterMode.value}</h2>
                                    <p className="text-slate-400 text-sm">Perfil Analítico</p>
                                </div>
                            </div>
                            <div className="flex gap-4 mt-4">
                                <div className="bg-white/10 px-4 py-2 rounded-xl backdrop-blur-sm">
                                    <p className="text-xs text-slate-400 font-bold uppercase">Total Tweets</p>
                                    <p className="text-xl font-bold">{userStats.total}</p>
                                </div>
                                <div className="bg-white/10 px-4 py-2 rounded-xl backdrop-blur-sm">
                                    <p className="text-xs text-slate-400 font-bold uppercase">Última Actividad</p>
                                    <p className="text-lg font-bold">{dayjs(userStats.lastTweet).format('DD MMM')}</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-3">
                            <a
                                href={`/api/archive/${encodeURIComponent(filterMode.value)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-green-500 hover:bg-green-600 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-green-500/20 flex items-center gap-2 transition-all hover:scale-105 active:scale-95 cursor-pointer no-underline"
                            >
                                <Save size={18} /> Descargar Historial
                            </a>
                            <p className="text-xs text-slate-400 max-w-[200px] text-right">
                                Descarga un archivo de texto con todos los tweets registrados de este usuario.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-100 gap-4">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Twitter className="text-blue-500" size={22} />
                        {filterMode
                            ? `Resultados para: ${filterMode.type === 'handle' ? '@' : '"'}${filterMode.value}${filterMode.type === 'handle' ? '' : '"'}`
                            : 'Feed en Vivo'}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                        {filterMode
                            ? <button onClick={() => fetchTweets(null)} className="text-red-500 hover:underline font-bold flex items-center gap-1 cursor-pointer"><X size={12} /> Quitar filtros</button>
                            : 'Últimos 50 tweets capturados'}
                    </p>
                </div>
                <div className="flex gap-2">
                    {filterMode && (
                        <button
                            onClick={() => fetchTweets(null)}
                            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
                        >
                            Ver Todos
                        </button>
                    )}
                    <button
                        onClick={() => fetchTweets(filterMode)}
                        className="flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-600 hover:text-blue-800 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer"
                    >
                        <RefreshCw size={16} className={feedLoading ? 'animate-spin' : ''} /> Actualizar
                    </button>
                </div>
            </div>

            {feedLoading && tweets.length === 0 ? (
                <div className="flex justify-center py-20">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                </div>
            ) : tweets.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <Search size={48} className="mx-auto mb-4 opacity-20" />
                    <p>No se encontraron tweets con estos criterios.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {tweets.map((tweet) => (
                        <div key={tweet.id || Math.random()} className="bg-white rounded-2xl shadow-sm border border-slate-100 hover:border-blue-200 hover:shadow-md transition-all duration-300 overflow-hidden group">
                            <div className="flex flex-col md:flex-row">
                                {/* Media Column */}
                                {(tweet.localPath || (tweet.mediaUrls && tweet.mediaUrls.length > 0)) && (
                                    <div className="md:w-72 flex-shrink-0 bg-slate-900 relative overflow-hidden flex items-center justify-center">
                                        {tweet.localPath ? (
                                            <video
                                                src={`/media/video/${tweet.localPath}`}
                                                controls
                                                className="w-full h-full object-contain max-h-[300px] md:max-h-full"
                                            />
                                        ) : (
                                            <img
                                                src={tweet.mediaUrls[0]}
                                                alt="Media"
                                                className="w-full h-full object-cover min-h-[200px]"
                                            />
                                        )}
                                        <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                            {tweet.localPath ? 'Video' : 'Imagen'}
                                        </div>
                                        {tweet.localPath && (
                                            <a
                                                href={`/media/video/${tweet.localPath}`}
                                                download={tweet.localPath}
                                                className="absolute bottom-2 right-2 bg-black/70 hover:bg-black/90 backdrop-blur-md text-white p-2.5 rounded-full shadow-lg transition-transform hover:scale-110"
                                                title="Descargar Video"
                                            >
                                                <Download size={18} />
                                            </a>
                                        )}
                                    </div>
                                )}

                                {/* Content */}
                                <div className="flex-1 p-5 flex flex-col">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm border border-slate-200 shadow-sm">
                                                {(tweet.handle || '?').replace('@', '').substring(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-slate-800 text-sm hover:text-blue-600 cursor-pointer" onClick={() => fetchTweets({ type: 'handle', value: tweet.handle })}>
                                                    {tweet.name || tweet.handle}
                                                </h4>
                                                <span className="text-xs text-slate-400 font-medium">{tweet.handle}</span>
                                            </div>
                                        </div>
                                        <span className="text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded border border-slate-100">
                                            {dayjs(tweet.date).format('DD/MMM HH:mm')}
                                        </span>
                                    </div>

                                    <p
                                        className="text-sm text-slate-700 leading-relaxed whitespace-pre-line mb-4 flex-1"
                                        dangerouslySetInnerHTML={{
                                            __html: (tweet.text || '').replace(
                                                /(https?:\/\/[^\s]+)/g,
                                                '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline break-all">$1</a>'
                                            )
                                        }}
                                    />

                                    {/* Link Preview Card */}
                                    {tweet.cardUrl && (
                                        <a href={tweet.cardUrl} target="_blank" rel="noopener noreferrer" className="block mb-4 border border-slate-200 rounded-xl overflow-hidden hover:bg-slate-50 transition-colors group/card">
                                            <div className="flex">
                                                {tweet.cardImage && (
                                                    <div className="w-24 h-24 flex-shrink-0">
                                                        <img src={tweet.cardImage} alt="Preview" className="w-full h-full object-cover" />
                                                    </div>
                                                )}
                                                <div className="p-3 flex-1 min-w-0 flex flex-col justify-center">
                                                    <h5 className="font-bold text-slate-800 text-xs truncate group-hover/card:text-blue-600 mb-1">
                                                        {tweet.cardTitle || (tweet.cardUrl.length > 50 ? tweet.cardUrl.substring(0, 50) + '...' : tweet.cardUrl)}
                                                    </h5>
                                                    <p className="text-[10px] text-slate-400 truncate">{tweet.cardUrl}</p>
                                                </div>
                                            </div>
                                        </a>
                                    )}

                                    <div className="flex items-center justify-between border-t border-slate-50 pt-3 mt-2">
                                        <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded ${tweet.type === 'video' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-500'
                                            }`}>
                                            {tweet.type || 'TEXT'}
                                        </span>
                                        {tweet.id && (
                                            <a
                                                href={`https://x.com/i/status/${tweet.id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs font-bold text-blue-500 hover:text-blue-700 flex items-center gap-1 hover:underline"
                                            >
                                                Ver en X <ExternalLink size={12} />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    // ====== CONFIG ======
    const renderConfig = () => {
        return (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Header */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-50 rounded-xl">
                            <Settings className="text-blue-600" size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">Centro de Control</h3>
                            <p className="text-sm text-slate-500">{totalKeywords} palabras clave activas monitoreadas.</p>
                        </div>
                    </div>
                    <button
                        onClick={saveKeywords}
                        className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-slate-900/20 flex items-center gap-2 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                    >
                        <Save size={18} /> Guardar Cambios
                    </button>
                </div>

                <div className="flex border-b border-slate-200 mb-6 mt-4">
                    <button
                        onClick={() => setConfigTab('twitter')}
                        className={`px-4 py-3 font-medium text-sm transition-colors relative ${configTab === 'twitter' ? 'text-blue-600 bg-white border-t border-x border-slate-200 rounded-t-lg -mb-px' : 'text-slate-500 hover:text-slate-700 bg-slate-50'}`}
                    >
                        Twitter (X) y General
                    </button>
                    <button
                        onClick={() => setConfigTab('facebook')}
                        className={`px-4 py-3 font-medium text-sm transition-colors relative ${configTab === 'facebook' ? 'text-blue-600 bg-white border-t border-x border-slate-200 rounded-t-lg -mb-px' : 'text-slate-500 hover:text-slate-700 bg-slate-50 border-b border-slate-200'}`}
                    >
                        Monitoreo Meta (Facebook)
                    </button>
                </div>

                {configTab === 'twitter' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Left Col: API Keys */}
                        <div className="space-y-6">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <Bot size={18} className="text-purple-500" /> API Keys
                                </h4>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">OpenAI API Key</label>
                                        <input
                                            type="password"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder="sk-..."
                                            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                                        />
                                    </div>
                                    <button
                                        onClick={saveApiKey}
                                        className="w-full bg-purple-50 text-purple-600 hover:bg-purple-100 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer"
                                    >
                                        Actualizar Llave
                                    </button>
                                </div>
                            </div>

                            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                                <h4 className="font-bold text-blue-800 mb-2 text-sm">ℹ️ Importante</h4>
                                <p className="text-xs text-blue-600 leading-relaxed">
                                    Las palabras clave se utilizan para categorizar los tweets en los gráficos de poder (Legislativo, Gobierno, Judicial).
                                    Agregar nuevos términos actualizará la búsqueda en tiempo real.
                                </p>
                            </div>
                        </div>

                        {/* Right Col: Keywords Editor */}
                        <div className="lg:col-span-2 space-y-6">
                            {Object.entries(keywords).map(([category, list]) => (
                                <div key={category} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 transition-all hover:shadow-md">
                                    <div className="flex justify-between items-center mb-4 border-b border-slate-50 pb-2">
                                        <h4 className="font-bold text-slate-800 flex items-center gap-2 capitalize">
                                            <div className={`w-3 h-3 rounded-full ${category === 'legislativo' ? 'bg-amber-500' : category === 'gobierno' ? 'bg-green-500' : 'bg-blue-500'}`}></div>
                                            {category}
                                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{list.length} términos</span>
                                        </h4>
                                        {editingCategory === category ? (
                                            <div className="flex gap-2">
                                                <button onClick={() => setEditingCategory(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
                                                <button onClick={saveCategoryEdit} className="text-green-500 hover:text-green-700 cursor-pointer"><Save size={18} /></button>
                                            </div>
                                        ) : (
                                            <button onClick={() => handleEditCategory(category)} className="text-slate-400 hover:text-blue-500 transition-colors cursor-pointer">
                                                <Edit size={16} />
                                            </button>
                                        )}
                                    </div>

                                    {editingCategory === category ? (
                                        <textarea
                                            value={tempKeywords}
                                            onChange={(e) => setTempKeywords(e.target.value)}
                                            className="w-full h-32 p-3 bg-slate-50 border border-blue-200 rounded-xl text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {list.slice(0, 20).map((kw, i) => (
                                                <span key={i} className="text-xs bg-slate-50 text-slate-600 border border-slate-100 px-2 py-1 rounded-lg">
                                                    {kw}
                                                </span>
                                            ))}
                                            {list.length > 20 && (
                                                <span className="text-xs bg-slate-100 text-slate-400 px-2 py-1 rounded-lg italic">
                                                    +{list.length - 20} más...
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderAI = () => (
        <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 h-[700px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-300">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 backdrop-blur-sm flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <Bot className="text-white" size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800">Asistente Legislativo</h3>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> En línea
                    </p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] p-5 rounded-2xl shadow-sm ${msg.role === 'user'
                            ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-br-none shadow-blue-500/20'
                            : 'bg-white border border-slate-100 text-slate-700 rounded-bl-none shadow-slate-200/50'
                            }`}>
                            {msg.role === 'assistant' && (
                                <div className="flex items-center gap-2 mb-2 text-xs font-bold text-indigo-500 uppercase tracking-wider">
                                    <Bot size={12} /> Monitor AI
                                </div>
                            )}
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        </div>
                    </div>
                ))}
                {aiLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-slate-100 p-4 rounded-2xl rounded-bl-none shadow-sm flex gap-2 items-center">
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-100"></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-200"></div>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-4 bg-white border-t border-slate-100 flex gap-3 items-end">
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white transition-all">
                    <input
                        type="text"
                        value={userPrompt}
                        onChange={(e) => setUserPrompt(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendAiMessage()}
                        placeholder="Escribe tu pregunta sobre el monitoreo..."
                        className="w-full bg-transparent p-2 outline-none text-slate-700 placeholder:text-slate-400"
                    />
                </div>
                <button
                    onClick={sendAiMessage}
                    disabled={aiLoading}
                    className={`h-12 w-12 flex items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 cursor-pointer ${aiLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'}`}
                >
                    <MessageSquare size={20} />
                </button>
            </div>
        </div>
    );

    const renderLogs = () => (
        <div className="mt-8 rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-[#0F172A]">
            <div className="bg-[#1E293B] px-4 py-3 flex justify-between items-center border-b border-slate-700">
                <h3 className="font-bold flex items-center gap-2 text-slate-100 text-sm">
                    <div className="flex gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500"></span><span className="w-3 h-3 rounded-full bg-yellow-500"></span><span className="w-3 h-3 rounded-full bg-green-500"></span></div>
                    <span className="ml-2 font-mono">monitor-x-v2</span>
                </h3>
                <span className="bg-green-500/10 text-green-400 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border border-green-500/20 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span> Live
                </span>
            </div>
            <pre ref={logsRef} className="p-6 h-64 overflow-y-auto font-mono text-xs leading-relaxed text-green-400 opacity-90 custom-scrollbar">
                {logs || <span className="text-slate-500 animate-pulse">Conectando con el stream de logs...</span>}
            </pre>
        </div>
    );

    const ArrowRightIcon = ({ className, size }) => (
        <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
    );

    return (
        <div className="min-h-screen flex bg-slate-50 font-sans text-slate-900">
            <aside className="w-72 bg-white border-r border-slate-200 hidden md:flex flex-col flex-shrink-0 z-20 shadow-xl shadow-slate-200/50">
                <div className="p-8">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-600/30">
                            <Radio size={24} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Monitor<span className="text-blue-600">Mor</span></h1>
                            <p className="text-xs text-slate-500 font-medium">v2.1 Pro</p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 px-4 space-y-2 mt-4">
                    <NavButton id="dashboard" icon={LayoutDashboard} label="Resumen Ejecutivo" />
                    <NavButton id="search" icon={Twitter} label="Feed de Tweets" />
                    <NavButton id="ai" icon={Bot} label="Asistente IA" />

                    <div className="pt-6 mt-6 border-t border-slate-100">
                        <p className="px-4 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Sistema</p>
                        <NavButton id="config" icon={Settings} label="Configuración" />
                    </div>
                </nav>

                <div className="p-6">
                    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-4 text-white shadow-lg relative overflow-hidden group hover:scale-[1.02] transition-transform cursor-pointer">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-white/5 rounded-full -mr-10 -mt-10 blur-xl"></div>
                        <h4 className="font-bold mb-1 relative z-10">Estado del Server</h4>
                        <div className="flex items-center gap-2 text-xs text-slate-300 relative z-10">
                            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                            134.199.230.46
                        </div>
                    </div>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto h-screen flex flex-col relative z-10">
                <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-5 flex justify-between items-center sticky top-0 z-50">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 tracking-tight">
                            {activeTab === 'dashboard' && 'Resumen Ejecutivo'}
                            {activeTab === 'search' && (filterMode ? 'Resultados de Búsqueda' : 'Feed de Tweets en Vivo')}
                            {activeTab === 'ai' && 'Chat Inteligente (IA)'}
                            {activeTab === 'config' && 'Centro de Configuración'}
                        </h2>
                        <p className="text-sm text-slate-500 hidden md:block">
                            {dayjs().format('dddd, D [de] MMMM [de] YYYY')}
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <button className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
                            <Zap size={20} />
                        </button>
                        <div className="w-px h-8 bg-slate-200"></div>
                        <div className="flex items-center gap-3 pl-2">
                            <div className="text-right hidden md:block">
                                <p className="text-sm font-bold text-slate-700">Admin User</p>
                                <p className="text-xs text-slate-400">Superadmin</p>
                            </div>
                            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20">
                                A
                            </div>
                        </div>
                    </div>
                </header>

                <div className="p-8 pb-32 flex-1 max-w-7xl mx-auto w-full">
                    {activeTab === 'dashboard' && renderDashboard()}
                    {activeTab === 'search' && renderFeed()}
                    {activeTab === 'ai' && renderAI()}
                    {activeTab === 'config' && renderConfig()}
                    {renderLogs()}
                </div>
            </main>
        </div>
    );
}

export default App;
