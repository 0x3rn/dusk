"use client";

import { motion } from "framer-motion";
import { Shield, Clock, Lock, Key, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function MarketingPage() {
  const staggerContainer = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
      },
    },
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 30 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 50 } },
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden selection:bg-primary/30 selection:text-primary">
      
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-background/50 backdrop-blur-xl">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/40 flex items-center justify-center shadow-[0_0_15px_rgba(var(--primary),0.5)]">
              <Shield className="w-4 h-4 text-background" />
            </div>
            <span className="text-xl font-bold tracking-tight">Dusk.</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Sign In
            </Link>
            <Button className="rounded-full shadow-[0_0_15px_rgba(var(--primary),0.3)]">Get Started</Button>
          </div>
        </div>
      </nav>

      <main className="pt-32 pb-24">
        {/* Hero Section */}
        <section className="container mx-auto px-6 relative">
          {/* Background Glows */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] -z-10 pointer-events-none" />
          
          <motion.div 
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="flex flex-col items-center text-center max-w-4xl mx-auto"
          >
            <motion.div variants={fadeInUp}>
              <Badge variant="outline" className="mb-6 border-primary/30 bg-primary/10 text-primary px-4 py-1.5 rounded-full backdrop-blur-sm">
                Introducing the Ultimate Digital Vault
              </Badge>
            </motion.div>
            
            <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
              Secure Your Legacy. <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-white/40">
                Pass It On When You're Gone.
              </span>
            </motion.h1>
            
            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl leading-relaxed">
              Dusk is a highly secure Dead Man’s Switch and digital estate vault. Store your passwords, seed phrases, and final wishes using Zero-Knowledge encryption. If you stop checking in, we'll automatically deliver your vault to your loved ones.
            </motion.p>
            
            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <Button size="lg" className="rounded-full h-14 px-8 text-base shadow-[0_0_20px_rgba(var(--primary),0.4)]">
                Secure Your Vault Today
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" className="rounded-full h-14 px-8 text-base border-white/10 hover:bg-white/5">
                Read the Security Whitepaper
              </Button>
            </motion.div>
          </motion.div>

          {/* Hero Image Mockup */}
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 1, type: "spring" }}
            className="mt-20 relative mx-auto max-w-5xl rounded-2xl border border-white/10 bg-black/40 shadow-2xl backdrop-blur-md overflow-hidden"
          >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
            <img 
              src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2070&auto=format&fit=crop" 
              alt="Dusk Dashboard Preview" 
              className="w-full object-cover opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
          </motion.div>
        </section>

        {/* How It Works */}
        <section className="container mx-auto px-6 mt-40">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">How the Switch Works</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Set it up once, check in quarterly, and rest easy knowing your most critical data is safe and ready to be passed on.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-1/2 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-transparent via-primary/20 to-transparent -translate-y-1/2 -z-10" />

            {[
              {
                icon: <Lock className="w-6 h-6 text-primary" />,
                title: "1. Store Secrets",
                desc: "Encrypt your wallets, passwords, and notes directly in your browser. We never see your data."
              },
              {
                icon: <Clock className="w-6 h-6 text-primary" />,
                title: "2. Check-in Every 3 Months",
                desc: "We'll send you an email or SMS. Simply click 'I am alive' to reset the 90-day timer."
              },
              {
                icon: <Key className="w-6 h-6 text-primary" />,
                title: "3. Auto-Delivery",
                desc: "If you fail to check in after multiple warnings, your emergency contacts receive the decryption keys."
              }
            ].map((step, i) => (
              <Card key={i} className="bg-background/50 backdrop-blur-sm border-white/5 relative group hover:border-primary/30 transition-colors">
                <CardHeader>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    {step.icon}
                  </div>
                  <CardTitle className="text-xl">{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">{step.desc}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Security Section */}
        <section className="container mx-auto px-6 mt-40">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.02] to-transparent p-8 md:p-16 flex flex-col md:flex-row items-center gap-16 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] -z-10" />
            
            <div className="flex-1">
              <Badge variant="outline" className="mb-6 border-white/10">True Zero-Knowledge</Badge>
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">Military-grade encryption. Client-side.</h2>
              <p className="text-lg text-muted-foreground mb-8">
                Your vault is encrypted using AES-256 before it ever leaves your device. We use the Web Crypto API to ensure that we, the developers, have absolutely zero access to your stored secrets. 
              </p>
              <ul className="space-y-4">
                {[
                  "End-to-End Encrypted Vaults",
                  "No Server-Side Key Storage",
                  "Secure URL Hash Fragment Delivery"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-muted-foreground">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="flex-1 relative w-full aspect-square md:aspect-auto md:h-[400px]">
              <div className="absolute inset-0 bg-black/50 rounded-2xl border border-white/10 p-6 font-mono text-sm text-primary/80 flex flex-col justify-center overflow-hidden shadow-2xl backdrop-blur-md">
                <div className="opacity-50">{"// Encryption Key Generation"}</div>
                <div>{"const key = await crypto.subtle.generateKey("}</div>
                <div className="pl-4">{"{ name: 'AES-GCM', length: 256 },"}</div>
                <div className="pl-4">{"true,"}</div>
                <div className="pl-4">{"['encrypt', 'decrypt']"}</div>
                <div>{");"}</div>
                <br />
                <div className="opacity-50">{"// Payload Encryption (Client-Side)"}</div>
                <div>{"const ciphertext = await crypto.subtle.encrypt("}</div>
                <div className="pl-4">{"{ name: 'AES-GCM', iv },"}</div>
                <div className="pl-4">{"key,"}</div>
                <div className="pl-4">{"new TextEncoder().encode(vaultData)"}</div>
                <div>{");"}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="container mx-auto px-6 mt-40 mb-20 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">Simple, Transparent Pricing</h2>
          <p className="text-muted-foreground text-lg mb-12">No subscriptions. Pay once, secure your legacy forever.</p>

          <Card className="max-w-md mx-auto bg-gradient-to-b from-background to-background/50 border-primary/20 shadow-[0_0_50px_rgba(var(--primary),0.1)] relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />
            <CardHeader className="pb-8 pt-12">
              <CardTitle className="text-2xl text-muted-foreground font-normal">Lifetime Access</CardTitle>
              <div className="mt-4 flex items-center justify-center gap-2">
                <span className="text-6xl font-bold">$50</span>
                <span className="text-xl text-muted-foreground mt-4">flat fee</span>
              </div>
            </CardHeader>
            <CardContent className="pb-12">
              <ul className="space-y-4 mb-8 text-left max-w-[250px] mx-auto">
                <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Unlimited Secrets</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Up to 5 Emergency Contacts</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> SMS & Email Check-ins</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> 24/7 Priority Support</li>
              </ul>
              <Button size="lg" className="w-full rounded-full h-14 text-base shadow-[0_0_20px_rgba(var(--primary),0.3)]">
                Get Lifetime Access
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 text-center text-muted-foreground">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Shield className="w-5 h-5" />
          <span className="text-xl font-bold tracking-tight text-foreground">Dusk.</span>
        </div>
        <p>© {new Date().getFullYear()} Dusk Digital Vault. All rights reserved.</p>
      </footer>
    </div>
  );
}
