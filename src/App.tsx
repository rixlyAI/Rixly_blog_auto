/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import BlogDashboard from "./components/BlogDashboard";
import { Toaster } from "@/components/ui/sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Sparkles } from "lucide-react";

const APP_PASSWORD = 's7p1"TVX[h0$';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const authStatus = localStorage.getItem("app_authenticated");
    if (authStatus === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === APP_PASSWORD) {
      setIsAuthenticated(true);
      localStorage.setItem("app_authenticated", "true");
      setError("");
    } else {
      setError("Incorrect password. Please try again.");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem("app_authenticated");
    setPassword("");
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 geometric-grid pointer-events-none opacity-50" />
        <div className="w-full max-w-sm relative z-10">
          <div className="flex items-center gap-4 justify-center mb-12">
            <div className="h-14 w-14 rounded-none bg-black flex items-center justify-center text-white">
              <Sparkles className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-3xl font-display font-bold tracking-tighter text-black uppercase leading-none">Rixly</h1>
              <p className="text-[10px] font-mono tracking-[0.3em] text-slate-400 mt-1 uppercase text-center md:text-left">Automator</p>
            </div>
          </div>
          
          <Card className="border-black shadow-none rounded-none bg-white">
            <CardHeader className="space-y-4 pb-8">
              <div className="flex items-center gap-2 text-black">
                <Lock className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Security Protocol</span>
              </div>
              <div className="space-y-1">
                <CardTitle className="text-xl font-display uppercase tracking-tight">Access Verification</CardTitle>
                <CardDescription className="text-xs uppercase tracking-wider opacity-60">
                  Authentication required for system entry.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-3">
                  <Input
                    type="password"
                    placeholder="KEY-IDENTIFIER"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 border-black rounded-none focus-visible:ring-black font-mono text-center tracking-widest"
                    autoFocus
                  />
                  {error && <p className="text-[10px] text-red-600 font-bold uppercase tracking-widest text-center">{error}</p>}
                </div>
                <Button type="submit" className="w-full h-12 bg-black hover:bg-slate-800 text-white font-display font-bold uppercase tracking-[0.2em] rounded-none transition-all">
                  Initiate Protocol
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      <BlogDashboard onLogout={handleLogout} />
      <Toaster position="top-right" />
    </div>
  );
}
