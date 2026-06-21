"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { 
  Shield, Clock, Lock, Key, ArrowRight, CheckCircle2, 
  Database, UserCheck, CloudOff, EyeOff, LockKeyhole
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";

export default function MarketingPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleCheckout = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 60 } },
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
            <ThemeToggle />
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
              Sign In
            </Link>
            <Button className="rounded-full shadow-[0_0_15px_rgba(var(--primary),0.3)]">Get Started</Button>
          </div>
        </div>
      </nav>

      <main className="pt-32 pb-24">
        {/* HERO SECTION */}
        <section className="container mx-auto px-6 relative">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/20 rounded-full blur-[150px] -z-10 pointer-events-none" />
          
          <motion.div variants={staggerContainer} initial="hidden" animate="show" className="flex flex-col items-center text-center max-w-5xl mx-auto">
            <motion.div variants={fadeInUp}>
              <Badge variant="outline" className="mb-6 border-primary/30 bg-primary/10 text-primary px-4 py-1.5 rounded-full backdrop-blur-sm">
                Next-Generation Digital Estate Management
              </Badge>
            </motion.div>
            
            <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
              Protect your legacy.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary/80 to-white">
                Pass it on automatically.
              </span>
            </motion.h1>
            
            <motion.p variants={fadeInUp} className="text-xl text-muted-foreground mb-10 max-w-3xl leading-relaxed">
              The world's most secure Dead Man's Switch. Encrypt your crypto wallets, passwords, and final wishes directly in your browser. We monitor your status, and if the worst happens, we seamlessly deliver your vault to your loved ones.
            </motion.p>
            
            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <Button size="lg" className="rounded-full h-14 px-8 text-base shadow-[0_0_30px_rgba(var(--primary),0.5)]">
                Secure Your Vault Today
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </motion.div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.8 }}
            className="mt-20 relative mx-auto max-w-5xl rounded-2xl border border-white/10 bg-black/40 shadow-2xl backdrop-blur-md overflow-hidden ring-1 ring-white/5"
          >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
            <img src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2070&auto=format&fit=crop" alt="Dashboard" className="w-full object-cover opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          </motion.div>
        </section>

        {/* TRUST BADGES */}
        <section className="container mx-auto px-6 mt-24 text-center border-y border-white/5 py-12 bg-white/[0.01]">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-8">Securing over $100M+ in digital assets</p>
          <div className="flex flex-wrap justify-center gap-12 md:gap-24 opacity-50 grayscale">
            {/* Mock logos using text */}
            <h3 className="text-2xl font-bold font-serif">CoinGuard</h3>
            <h3 className="text-2xl font-bold tracking-tighter">VaultTech</h3>
            <h3 className="text-2xl font-bold italic">SecureNet</h3>
            <h3 className="text-2xl font-bold font-mono">HASH.SYS</h3>
          </div>
        </section>

        {/* BENTO GRID FEATURES */}
        <section className="container mx-auto px-6 mt-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">A flawless architecture</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Dusk is built on modern cryptography and resilient cloud infrastructure. We ensure zero points of failure.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {/* Large Card */}
            <Card className="md:col-span-2 bg-gradient-to-br from-background to-primary/5 border-white/10 relative overflow-hidden group">
              <div className="absolute -right-20 -top-20 w-64 h-64 bg-primary/10 rounded-full blur-[80px] group-hover:bg-primary/20 transition-all duration-700" />
              <CardHeader>
                <LockKeyhole className="w-10 h-10 text-primary mb-2" />
                <CardTitle className="text-2xl">Client-Side Encryption</CardTitle>
                <CardDescription className="text-base text-muted-foreground">Your vault never leaves your device unencrypted.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-6">We utilize the native Web Crypto API (AES-GCM-256) inside your browser. The decryption keys are transmitted via secure URL hashes, meaning our servers only ever store encrypted gibberish.</p>
                <div className="p-4 bg-black/40 rounded-lg border border-white/5 font-mono text-xs text-primary/80">
                  {">"} crypto.subtle.encrypt({"{ name: 'AES-GCM', iv }"}, key, data)<br/>
                  {">"} 0x8f2a1b9c3e... (Ciphertext sent to Dusk)
                </div>
              </CardContent>
            </Card>

            <Card className="bg-background/50 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <Clock className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Automated Checks</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">We monitor your status. If you don't click the "I am alive" button every 90 days, the Dead Man's Switch protocol engages.</p>
              </CardContent>
            </Card>

            <Card className="bg-background/50 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <CloudOff className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Zero Server Access</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">We cannot access your data, nor can anyone who breaches our databases or subpoenas us. True zero-knowledge.</p>
              </CardContent>
            </Card>

            <Card className="md:col-span-2 bg-background/50 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <UserCheck className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Multi-Recipient Routing</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Assign up to 5 emergency contacts. When the switch triggers, each contact automatically receives an SMS and email containing the secure link required to decrypt your vault.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* PRICING */}
        <section className="container mx-auto px-6 mt-40">
          <div className="max-w-4xl mx-auto rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/10 to-background p-8 md:p-16 text-center relative overflow-hidden shadow-[0_0_50px_rgba(var(--primary),0.05)]">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">One Payment. Lifetime Peace of Mind.</h2>
            <p className="text-muted-foreground text-lg mb-10 max-w-xl mx-auto">No recurring subscriptions. Protect your legacy forever with a single flat fee.</p>
            
            <div className="flex items-center justify-center gap-2 mb-10">
              <span className="text-7xl font-bold">$50</span>
              <span className="text-xl text-muted-foreground mt-6">/ lifetime</span>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 max-w-xl mx-auto mb-10 text-left">
              <div className="flex items-center gap-3"><CheckCircle2 className="text-primary w-5 h-5" /> AES-256 Client Encryption</div>
              <div className="flex items-center gap-3"><CheckCircle2 className="text-primary w-5 h-5" /> 5 Emergency Contacts</div>
              <div className="flex items-center gap-3"><CheckCircle2 className="text-primary w-5 h-5" /> SMS & Email Triggers</div>
              <div className="flex items-center gap-3"><CheckCircle2 className="text-primary w-5 h-5" /> Zero-Knowledge Architecture</div>
            </div>

            <Button 
              size="lg" 
              onClick={handleCheckout} 
              disabled={isLoading}
              className="rounded-full h-14 px-12 text-lg shadow-[0_0_30px_rgba(var(--primary),0.4)]"
            >
              {isLoading ? "Securely redirecting..." : "Activate Lifetime Vault"}
            </Button>
          </div>
        </section>

        {/* FAQ */}
        <section className="container mx-auto px-6 mt-40 max-w-3xl">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-10 text-center">Frequently Asked Questions</h2>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1" className="border-white/10">
              <AccordionTrigger className="text-lg hover:text-primary">What happens if I forget to check in?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                We will send you multiple warning emails and SMS messages 7 days before your 90-day timer expires. If you completely ignore all warnings and the timer reaches zero, the system assumes you have passed away and automatically routes the decryption keys to your emergency contacts.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2" className="border-white/10">
              <AccordionTrigger className="text-lg hover:text-primary">Can Dusk employees read my passwords?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                No. Because of our Zero-Knowledge architecture, your vault is encrypted inside your browser before it is saved to our database. We never possess the decryption keys. Even under a subpoena, we can only hand over encrypted ciphertext.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3" className="border-white/10">
              <AccordionTrigger className="text-lg hover:text-primary">Is it really a one-time fee?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base">
                Yes. We charge a flat $50 to cover the infrastructure, SMS delivery fees, and secure storage for your lifetime. There are no recurring monthly subscriptions.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 mt-20 bg-black/20">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="text-xl font-bold tracking-tight text-foreground">Dusk.</span>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
            <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
            <Link href="#" className="hover:text-primary transition-colors">Security Whitepaper</Link>
          </div>
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} Dusk Digital Vault.</p>
        </div>
      </footer>
    </div>
  );
}
