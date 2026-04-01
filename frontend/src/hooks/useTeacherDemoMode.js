import { useCallback, useEffect, useRef, useState } from 'react';

function resolveWsUrl(hostname, appId, role) {
  return `ws://${hostname}:4100/ws/demo?role=${encodeURIComponent(role)}&app=${encodeURIComponent(appId)}`;
}

export default function useTeacherDemoMode({ appId, onState }) {
  const [mode, setMode] = useState('off');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [localIp, setLocalIp] = useState('');
  const [teacherIp, setTeacherIp] = useState('');
  const [error, setError] = useState('');
  const socketRef = useRef(null);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, []);

  const connect = useCallback((role, host) => {
    disconnect();
    setError('');
    setConnectionStatus('connecting');

    const ws = new WebSocket(resolveWsUrl(host, appId, role));
    socketRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
    };

    ws.onerror = () => {
      setConnectionStatus('disconnected');
      setError('Unable to connect demo socket.');
    };

    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'hello') {
        if (message.payload?.primaryIp) {
          setLocalIp(message.payload.primaryIp);
        }
        return;
      }

      if (message.type === 'state' && role === 'student') {
        onState?.(message.payload);
        return;
      }

      if (message.type === 'teacher-offline') {
        setError('Teacher disconnected.');
      }
    };
  }, [appId, disconnect, onState]);

  const startTeacher = useCallback(async () => {
    setMode('teacher');
    try {
      const response = await fetch('/api/demo/network');
      const payload = await response.json();
      if (response.ok && payload?.primaryIp) {
        setLocalIp(payload.primaryIp);
      }
    } catch {
      // ignore, websocket hello can still provide local ip
    }
    connect('teacher', window.location.hostname || '127.0.0.1');
  }, [connect]);

  const joinTeacher = useCallback((ip) => {
    if (!ip?.trim()) {
      setError('Teacher IP is required.');
      return;
    }
    const cleaned = ip.trim();
    setTeacherIp(cleaned);
    setMode('student');
    connect('student', cleaned);
  }, [connect]);

  const stopDemo = useCallback(() => {
    setMode('off');
    setTeacherIp('');
    setError('');
    disconnect();
  }, [disconnect]);

  const broadcastState = useCallback((payload) => {
    if (mode !== 'teacher' || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    socketRef.current.send(JSON.stringify({ type: 'state', payload }));
  }, [mode]);

  useEffect(() => () => {
    disconnect();
  }, [disconnect]);

  return {
    mode,
    connectionStatus,
    localIp,
    teacherIp,
    error,
    startTeacher,
    joinTeacher,
    stopDemo,
    broadcastState,
    isTeacher: mode === 'teacher',
    isStudent: mode === 'student',
  };
}
