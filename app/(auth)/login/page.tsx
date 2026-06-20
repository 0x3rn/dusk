"use client";

import { useState } from "react";
import { Shield, Mail, Lock, ArrowRight, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  // Note: Firebase auth will be implemented here when env vars are available
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Login attempted with", email);
    // Placeholder redirect for now
    window.location.href = "/dashboard";
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      {/* Background Orbs */}
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-primary/20 rounded-full blur-[100px] -z-10 pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-primary/10 rounded-full blur-[100px] -z-10 pointer-events-none" />

      <Link href="/" className="absolute top-8 left-8 flex items-center gap-2 transition-opacity hover:opacity-80">
        <Shield className="w-6 h-6 text-primary" />
        <span className="text-xl font-bold">Dusk.</span>
      </Link>

      <Card className="w-full max-w-md bg-background/50 backdrop-blur-xl border-white/10 shadow-2xl">
        <CardHeader className="space-y-1 pb-6">
          <CardTitle className="text-2xl font-bold text-center">Welcome back</CardTitle>
          <CardDescription className="text-center">
            Sign in to access your secure digital vault
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="email" 
                  placeholder="name@example.com" 
                  className="pl-9 bg-black/20 border-white/10 focus-visible:ring-primary/50"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="password" 
                  placeholder="Password" 
                  className="pl-9 bg-black/20 border-white/10 focus-visible:ring-primary/50"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full shadow-[0_0_15px_rgba(var(--primary),0.3)]">
              Sign In
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Button variant="outline" className="w-full border-white/10 bg-black/20 hover:bg-white/5">
            <Github className="mr-2 h-4 w-4" />
            GitHub
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center border-t border-white/5 pt-6">
          <p className="text-sm text-muted-foreground">
            Don't have an account? <Link href="/signup" className="text-primary hover:underline">Sign up</Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
