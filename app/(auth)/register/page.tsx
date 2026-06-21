"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    // Register / checkout logic
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary opacity-[0.05] blur-[100px] rounded-full pointer-events-none hidden dark:block -z-10" />

      <Link href="/" className="mb-8 text-2xl font-bold tracking-tight text-foreground hover:opacity-80 transition-opacity">
        Dusk
      </Link>

      <div className="w-full max-w-md border border-border bg-card backdrop-blur-md rounded-2xl p-8 shadow-none">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">Create Your Vault</h1>
          <p className="text-sm text-muted-foreground">One-time payment. Lifetime protection.</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2 ml-1">Full Name</label>
            <input 
              type="text" 
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-transparent border border-border focus:border-primary focus:ring-1 focus:ring-primary rounded-lg p-3 text-foreground outline-none transition-all"
              placeholder="Satoshi Nakamoto"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2 ml-1">Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent border border-border focus:border-primary focus:ring-1 focus:ring-primary rounded-lg p-3 text-foreground outline-none transition-all"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2 ml-1">Master Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent border border-border focus:border-primary focus:ring-1 focus:ring-primary rounded-lg p-3 text-foreground outline-none transition-all"
              placeholder="Make it extremely strong"
            />
            <p className="text-[10px] text-muted-foreground mt-2 ml-1">
              We cannot reset this password. If you lose it, your vault is gone forever.
            </p>
          </div>

          <button 
            type="submit"
            className="w-full bg-primary text-primary-foreground hover:bg-emerald-700 dark:hover:bg-[#00FFA3]/80 font-medium transition-colors p-3 rounded-lg flex items-center justify-center gap-2 mt-4 shadow-none"
          >
            <Shield strokeWidth={1.5} className="w-4 h-4" />
            Pay $50 & Create Vault
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          Already have a vault?{" "}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
