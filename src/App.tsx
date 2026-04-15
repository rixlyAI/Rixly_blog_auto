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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 justify-center mb-8">
            <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <Sparkles className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rixly Automator</h1>
          </div>
          
          <Card className="border-slate-200 shadow-xl">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2 text-indigo-600 mb-2">
                <Lock className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Protected Access</span>
              </div>
              <CardTitle className="text-xl">Enter Password</CardTitle>
              <CardDescription>
                Please enter the application password to access the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11"
                    autoFocus
                  />
                  {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
                </div>
                <Button type="submit" className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
                  Access Dashboard
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans antialiased">
      <BlogDashboard onLogout={handleLogout} />
      <Toaster position="top-right" />
    </div>
  );
}
