"use client";

import { useState } from "react";
import { Shield, Clock, Users, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      
      {/* HEADER / NAVBAR */}
      <nav className="border-b border-border bg-background sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-2xl font-bold tracking-tight text-foreground">
              Dusk
            </Link>
            <div className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
              <Link href="#features" className="hover:text-foreground">Features</Link>
              <Link href="#how-it-works" className="hover:text-foreground">How It Works</Link>
              <Link href="#pricing" className="hover:text-foreground">Pricing</Link>
              <Link href="#faq" className="hover:text-foreground">FAQ</Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link href="/login" className="text-sm font-bold text-foreground hover:underline hidden sm:block">
              Sign In
            </Link>
            <Button className="rounded-md font-bold shadow-sm">
              Create Vault
            </Button>
          </div>
        </div>
      </nav>

      <main>
        {/* HERO SECTION */}
        <section className="container mx-auto px-6 pt-24 pb-16 text-center max-w-5xl">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-foreground mb-8 leading-tight">
            Your Digital Legacy, Cryptographically Secured.
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground mb-10 max-w-3xl mx-auto leading-relaxed">
            The ultimate Dead Man’s Switch. We ensure your loved ones recover your crypto wallets, passwords, and final wishes when you are no longer here. Zero-knowledge architecture. One simple lifetime fee.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Button size="lg" className="rounded-md text-lg h-14 px-8 font-bold w-full sm:w-auto shadow-sm">
              Secure Your Vault — $50 Lifetime
            </Button>
            <Button size="lg" variant="outline" className="rounded-md text-lg h-14 px-8 font-bold w-full sm:w-auto bg-background hover:bg-muted">
              Read the Security Whitepaper
            </Button>
          </div>

          <div className="relative mx-auto w-full aspect-video md:aspect-[21/9] border border-border rounded-md overflow-hidden bg-muted shadow-sm">
            <img 
              src="https://images.unsplash.com/photo-1563206767-5b18f218e8de?auto=format&fit=crop&w=2000&q=80" 
              alt="Impenetrable steel bank vault door" 
              className="w-full h-full object-cover"
            />
          </div>
        </section>

        {/* SOCIAL PROOF BANNER */}
        <section className="border-y border-border bg-muted py-6">
          <div className="container mx-auto px-6 text-center">
            <p className="text-sm font-bold text-muted-foreground tracking-widest">
              SECURING MILLIONS IN DIGITAL ASSETS AND FINAL WISHES
            </p>
          </div>
        </section>

        {/* THE PROBLEM/SOLUTION SECTION (Feature Grid) */}
        <section id="features" className="container mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground">Total Security. Zero Human Intervention.</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div className="border border-border rounded-md p-8 bg-card shadow-sm flex flex-col items-start text-left">
              <div className="w-12 h-12 bg-primary flex items-center justify-center rounded-md mb-6">
                <Shield className="w-6 h-6 text-primary-foreground" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-foreground">AES-256 Client-Side Encryption</h3>
              <p className="text-muted-foreground leading-relaxed">
                Your vault is encrypted directly in your browser. We never see your master key, and we can never read your data. True zero-knowledge architecture.
              </p>
            </div>

            <div className="border border-border rounded-md p-8 bg-card shadow-sm flex flex-col items-start text-left">
              <div className="w-12 h-12 bg-primary flex items-center justify-center rounded-md mb-6">
                <Clock className="w-6 h-6 text-primary-foreground" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-foreground">Automated Contingency</h3>
              <p className="text-muted-foreground leading-relaxed">
                If you fail to check in via our secure email or SMS link every 90 days, our system assumes the worst and automatically triggers your contingency plan.
              </p>
            </div>

            <div className="border border-border rounded-md p-8 bg-card shadow-sm flex flex-col items-start text-left">
              <div className="w-12 h-12 bg-primary flex items-center justify-center rounded-md mb-6">
                <Users className="w-6 h-6 text-primary-foreground" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-foreground">Multi-Recipient Routing</h3>
              <p className="text-muted-foreground leading-relaxed">
                Designate up to 5 emergency contacts. When the switch triggers, they securely receive the decryption keys required to open your vault.
              </p>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="border-t border-border bg-muted py-24">
          <div className="container mx-auto px-6 max-w-4xl">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground mb-16 text-center">How Dusk Protects Your Legacy</h2>
            
            <div className="space-y-8">
              <div className="border border-border bg-background p-8 rounded-md shadow-sm">
                <h3 className="text-2xl font-bold mb-2 text-foreground">1. Encrypt Your Assets.</h3>
                <p className="text-lg text-muted-foreground">Store seed phrases, PINs, and documents. Everything is locked with military-grade encryption.</p>
              </div>

              <div className="border border-border bg-background p-8 rounded-md shadow-sm">
                <h3 className="text-2xl font-bold mb-2 text-foreground">2. The Heartbeat Check.</h3>
                <p className="text-lg text-muted-foreground">We ping you every 3 months. Click a single button to confirm you are alive and reset the timer.</p>
              </div>

              <div className="border border-border bg-background p-8 rounded-md shadow-sm">
                <h3 className="text-2xl font-bold mb-2 text-foreground">3. The Handover.</h3>
                <p className="text-lg text-muted-foreground">If you miss your check-in, Dusk automatically emails your designated contacts with secure access to your decrypted files.</p>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING SECTION */}
        <section id="pricing" className="container mx-auto px-6 py-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground mb-4">No Subscriptions. Just Peace of Mind.</h2>
            <p className="text-xl text-muted-foreground">End-of-life planning shouldn't come with a monthly bill.</p>
          </div>

          <div className="max-w-md mx-auto border-2 border-border bg-card rounded-md shadow-sm overflow-hidden flex flex-col">
            <div className="p-10 text-center border-b border-border bg-muted/30">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="text-6xl font-extrabold text-foreground">$50</span>
              </div>
              <span className="text-lg font-bold text-muted-foreground uppercase tracking-wider">Lifetime</span>
            </div>
            
            <div className="p-10 flex-1 flex flex-col">
              <ul className="space-y-5 mb-10 text-left flex-1">
                <li className="flex items-center gap-3 text-foreground font-medium"><CheckCircle2 className="w-5 h-5 text-primary" /> Client-Side AES-256 Encryption</li>
                <li className="flex items-center gap-3 text-foreground font-medium"><CheckCircle2 className="w-5 h-5 text-primary" /> 5 Emergency Contacts</li>
                <li className="flex items-center gap-3 text-foreground font-medium"><CheckCircle2 className="w-5 h-5 text-primary" /> Email & SMS Heartbeat Triggers</li>
                <li className="flex items-center gap-3 text-foreground font-medium"><CheckCircle2 className="w-5 h-5 text-primary" /> Unlimited Secure Text Storage</li>
                <li className="flex items-center gap-3 text-foreground font-medium"><CheckCircle2 className="w-5 h-5 text-primary" /> 24/7 Automated Monitoring</li>
              </ul>
              
              <Button 
                size="lg" 
                onClick={handleCheckout} 
                disabled={isLoading}
                className="w-full rounded-md h-14 text-lg font-bold shadow-sm"
              >
                {isLoading ? "Redirecting..." : "Activate Lifetime Vault"}
              </Button>
            </div>
          </div>
        </section>

        {/* FAQ SECTION */}
        <section id="faq" className="border-t border-border py-24 bg-muted/30">
          <div className="container mx-auto px-6 max-w-3xl">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground mb-12 text-center">Frequently Asked Questions</h2>
            
            <Accordion type="single" collapsible className="w-full space-y-4">
              <AccordionItem value="item-1" className="border border-border bg-background rounded-md px-6">
                <AccordionTrigger className="text-lg font-bold hover:no-underline py-6">What happens if I just forget to check in?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                  We send you multiple warnings at 14 days, 7 days, and 24 hours before triggering the vault. We use both email and SMS to ensure you don't miss it.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-2" className="border border-border bg-background rounded-md px-6">
                <AccordionTrigger className="text-lg font-bold hover:no-underline py-6">Can Dusk employees read my passwords?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                  Absolutely not. Your data is encrypted on your own device before it ever reaches our servers. Without your unique master key, your vault is mathematically impossible to open.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-3" className="border border-border bg-background rounded-md px-6">
                <AccordionTrigger className="text-lg font-bold hover:no-underline py-6">Is it really a one-time fee?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                  Yes. We use highly efficient cloud infrastructure (Firebase) that costs us fractions of a cent per user per year. A $50 flat fee ensures we can maintain your vault indefinitely.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-slate-950 border-t border-slate-900 py-16">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-16">
            <div className="md:col-span-1">
              <span className="text-2xl font-bold tracking-tight text-white mb-6 block">Dusk.</span>
              <p className="text-slate-400 text-sm">
                Cryptographically secured digital estate management. 
                Pass on your legacy safely.
              </p>
            </div>
            
            <div>
              <h4 className="text-white font-bold mb-4">Product</h4>
              <ul className="space-y-2">
                <li><Link href="#features" className="text-slate-400 hover:text-white text-sm">Features</Link></li>
                <li><Link href="#pricing" className="text-slate-400 hover:text-white text-sm">Pricing</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-white font-bold mb-4">Legal</h4>
              <ul className="space-y-2">
                <li><Link href="#" className="text-slate-400 hover:text-white text-sm">Privacy Policy</Link></li>
                <li><Link href="#" className="text-slate-400 hover:text-white text-sm">Terms of Service</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-white font-bold mb-4">Security</h4>
              <ul className="space-y-2">
                <li><Link href="#" className="text-slate-400 hover:text-white text-sm">Security Whitepaper</Link></li>
                <li><Link href="#" className="text-slate-400 hover:text-white text-sm">Bug Bounty</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-slate-800 text-sm text-slate-500">
            © 2026 Dusk Technologies. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
