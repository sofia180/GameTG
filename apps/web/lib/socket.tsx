"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./auth";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  const instance = useMemo(() => {
    if (!token) return null;
    return io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      reconnectionDelayMax: 4000
    });
  }, [token]);

  useEffect(() => {
    if (!instance || !token) return;
    const handleConnect = () => {
      instance.emit("authenticate", { token });
    };
    const heartbeat = setInterval(() => {
      instance.emit("heartbeat");
    }, 8000);
    instance.on("connect", handleConnect);
    instance.connect();
    handleConnect();
    setSocket(instance);
    return () => {
      instance.off("connect", handleConnect);
      instance.disconnect();
      setSocket(null);
      clearInterval(heartbeat);
    };
  }, [instance, token]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
