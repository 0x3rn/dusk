"use client";

import { useState } from "react";
import { 
  Shield, 
  Lock, 
  EyeOff, 
  CreditCard, 
  Clock, 
  XCircle, 
  CheckCircle2, 
  Server, 
  Briefcase, 
  Plane, 
  FileText, 
  Users, 
  Mail, 
  MessageSquare, 
  RefreshCcw, 
  ArrowRight,
  User,
  Database
} from "lucide-react";
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
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20 overflow-x-hidden">
      
      {/* 1. NAVBAR */}
      <nav className="border-b border-border sticky top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-xl font-bold tracking-tight">
              Dusk
            </Link>
            <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-muted-foreground">
              <Link href="#features" className="hover:text-foreground transition-colors">Features</Link>
              <Link href="#security" className="hover:text-foreground transition-colors">Security</Link>
              <Link href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</Link>
              <Link href="#use-cases" className="hover:text-foreground transition-colors">Use Cases</Link>
              <Link href="#pricing" className="hover:text-foreground transition-colors">Pricing</Link>
              <Link href="#faq" className="hover:text-foreground transition-colors">FAQ</Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link href="/login" className="text-sm font-medium hover:text-foreground transition-colors hidden sm:block">
              Sign In
            </Link>
            <Link href="/register" className="bg-primary text-primary-foreground hover:bg-emerald-700 dark:hover:bg-[#00FFA3]/80 font-medium transition-colors px-5 py-2 rounded-md text-sm shadow-none">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <main>
        {/* 2. HERO SECTION */}
        <section className="relative container mx-auto px-6 pt-32 pb-20 text-center max-w-5xl">
          {/* Hero Glow in Dark Mode */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#00FFA3] opacity-[0.07] blur-[100px] rounded-full pointer-events-none hidden dark:block -z-10" />

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter leading-tight mb-6">
            Your Digital Legacy Shouldn't Die With You.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed">
            Store crypto wallets, passwords, financial instructions, and final wishes inside a zero-knowledge encrypted vault that automatically reaches the people you trust if you're no longer here.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-24">
            <Link href="/register" className="bg-primary text-primary-foreground hover:bg-emerald-700 dark:hover:bg-[#00FFA3]/80 font-semibold transition-colors px-8 py-4 rounded-md text-base w-full sm:w-auto shadow-none flex items-center justify-center">
              Get Started Free
            </Link>
            <Link href="#how-it-works" className="border border-border hover:bg-muted text-foreground rounded-md font-medium transition-colors px-8 py-4 text-base w-full sm:w-auto shadow-none flex items-center justify-center">
              See How It Works
            </Link>
          </div>

          {/* Diagram Box */}
          <div className="border border-border rounded-2xl bg-card shadow-none mx-auto w-full max-w-4xl p-8 md:p-12 relative z-10 backdrop-blur-md">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-sm font-medium text-foreground">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full border border-border bg-background flex items-center justify-center shadow-none">
                  <User strokeWidth={1.5} className="w-6 h-6 text-primary" />
                </div>
                <span>You</span>
              </div>
              <ArrowRight strokeWidth={1.5} className="w-5 h-5 text-muted-foreground hidden md:block" />
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-lg border border-primary/50 bg-primary/10 flex items-center justify-center shadow-none">
                  <Shield strokeWidth={1.5} className="w-6 h-6 text-primary" />
                </div>
                <span>Encrypted Vault</span>
              </div>
              <ArrowRight strokeWidth={1.5} className="w-5 h-5 text-muted-foreground hidden md:block" />
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full border border-border bg-background flex items-center justify-center shadow-none">
                  <Clock strokeWidth={1.5} className="w-6 h-6 text-muted-foreground" />
                </div>
                <span>90-Day Check-In</span>
              </div>
              <ArrowRight strokeWidth={1.5} className="w-5 h-5 text-muted-foreground hidden md:block" />
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full border border-border bg-background flex items-center justify-center shadow-none">
                  <Users strokeWidth={1.5} className="w-6 h-6 text-primary" />
                </div>
                <span>Trusted Contacts</span>
              </div>
            </div>
          </div>
        </section>

        {/* 3. TRUST STRIP */}
        <section className="border-y border-border py-5 bg-background">
          <div className="container mx-auto px-6">
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-4 text-sm font-medium text-muted-foreground">
              <span className="flex items-center gap-2"><Lock strokeWidth={1.5} className="w-4 h-4" /> AES-256 Client-Side Encryption</span>
              <span className="hidden md:inline">•</span>
              <span className="flex items-center gap-2"><EyeOff strokeWidth={1.5} className="w-4 h-4" /> Zero-Knowledge Architecture</span>
              <span className="hidden md:inline">•</span>
              <span className="flex items-center gap-2"><CreditCard strokeWidth={1.5} className="w-4 h-4" /> One-Time Payment</span>
              <span className="hidden lg:inline">•</span>
              <span className="flex items-center gap-2"><Shield strokeWidth={1.5} className="w-4 h-4" /> No Human Access</span>
              <span className="hidden lg:inline">•</span>
              <span className="flex items-center gap-2"><RefreshCcw strokeWidth={1.5} className="w-4 h-4" /> Automated Recovery</span>
            </div>
          </div>
        </section>

        {/* 4. THE PROBLEM SECTION */}
        <section className="container mx-auto px-6 py-32 max-w-6xl relative">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-4">What Happens To Your Digital Assets If You're Gone Tomorrow?</h2>
            <p className="text-xl text-muted-foreground">Even when assets exist, the credentials often die with the owner.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="border border-border bg-card rounded-2xl p-8 shadow-none">
              <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3">
                <XCircle strokeWidth={1.5} className="w-6 h-6 text-red-500" /> 
                Family Locked Out
              </h3>
              <p className="text-muted-foreground mb-6">Most families never gain access to:</p>
              <ul className="space-y-4 text-foreground font-medium">
                <li className="flex items-center gap-3"><XCircle strokeWidth={1.5} className="w-5 h-5 text-red-500/50" /> Crypto wallets & Exchange accounts</li>
                <li className="flex items-center gap-3"><XCircle strokeWidth={1.5} className="w-5 h-5 text-red-500/50" /> Password managers & 2FA keys</li>
                <li className="flex items-center gap-3"><XCircle strokeWidth={1.5} className="w-5 h-5 text-red-500/50" /> Banking & Investment instructions</li>
                <li className="flex items-center gap-3"><XCircle strokeWidth={1.5} className="w-5 h-5 text-red-500/50" /> Domain names & Business accounts</li>
                <li className="flex items-center gap-3"><XCircle strokeWidth={1.5} className="w-5 h-5 text-red-500/50" /> Personal final wishes</li>
              </ul>
            </div>
            
            <div className="border border-primary/20 bg-primary/5 rounded-2xl p-8 shadow-none">
              <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3">
                <CheckCircle2 strokeWidth={1.5} className="w-6 h-6 text-primary" /> 
                Dusk Recovery Activated
              </h3>
              <p className="text-muted-foreground mb-6">With Dusk, your designated emergency contacts automatically receive the exact decryption keys and instructions they need, exactly when they need them.</p>
              <ul className="space-y-4 text-foreground font-medium">
                <li className="flex items-center gap-3"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Seed phrases securely transferred</li>
                <li className="flex items-center gap-3"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Vault contents fully decrypted locally</li>
                <li className="flex items-center gap-3"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Timely handover without courts</li>
                <li className="flex items-center gap-3"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Business continuity preserved</li>
                <li className="flex items-center gap-3"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Peace of mind guaranteed</li>
              </ul>
            </div>
          </div>
        </section>

        {/* 5. THE SOLUTION SECTION */}
        <section id="features" className="border-t border-border bg-card py-32">
          <div className="container mx-auto px-6 max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-4">Dusk Makes Recovery Automatic.</h2>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-background border border-border rounded-2xl p-8 shadow-none flex flex-col h-full">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6">
                  <Lock strokeWidth={1.5} className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-3">Encrypt Everything</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Store passwords, wallet seed phrases, instructions, documents, and messages. Everything is locked directly on your device.
                </p>
              </div>

              <div className="bg-background border border-border rounded-2xl p-8 shadow-none flex flex-col h-full">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6">
                  <RefreshCcw strokeWidth={1.5} className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-3">Stay Alive Check</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Every 90 days we ask for a quick confirmation via email or SMS. Simply click the secure link to confirm you are okay and reset the timer.
                </p>
              </div>

              <div className="bg-background border border-border rounded-2xl p-8 shadow-none flex flex-col h-full">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6">
                  <Mail strokeWidth={1.5} className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-3">Automatic Release</h3>
                <p className="text-muted-foreground leading-relaxed">
                  If you fail to respond to multiple warnings, your designated contacts receive secure recovery instructions to unlock your specific vault.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. SECURITY SECTION */}
        <section id="security" className="container mx-auto px-6 py-32 max-w-6xl">
          <div className="grid lg:grid-cols-2 gap-16 items-center mb-16">
            <div>
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-6">Built So Even We Can't Access Your Vault.</h2>
              <ul className="space-y-6 text-lg text-muted-foreground">
                <li className="flex items-start gap-4">
                  <CheckCircle2 strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0 mt-1" />
                  <span><strong>Client-Side Encryption:</strong> Data is encrypted in your browser before transmission.</span>
                </li>
                <li className="flex items-start gap-4">
                  <CheckCircle2 strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0 mt-1" />
                  <span><strong>AES-256:</strong> We use military-grade encryption standards to secure your payload.</span>
                </li>
                <li className="flex items-start gap-4">
                  <CheckCircle2 strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0 mt-1" />
                  <span><strong>Zero-Knowledge Architecture:</strong> We literally cannot decrypt your data. Period.</span>
                </li>
                <li className="flex items-start gap-4">
                  <CheckCircle2 strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0 mt-1" />
                  <span><strong>Unique Master Key:</strong> Your key is derived from a password only you know.</span>
                </li>
              </ul>
            </div>

            <div className="border border-border bg-card rounded-2xl p-8 shadow-none flex flex-col gap-6">
              <div className="border border-border bg-background rounded-xl p-4 text-center font-medium">
                [Your Device (Encrypts Data)]
              </div>
              <div className="flex justify-center"><ArrowRight strokeWidth={1.5} className="w-5 h-5 text-muted-foreground rotate-90" /></div>
              <div className="border border-border bg-muted rounded-xl p-4 text-center font-mono text-xs text-muted-foreground break-all">
                U2FsdGVkX1+x8w4f2y1... (Encrypted Gibberish)
              </div>
              <div className="flex justify-center"><ArrowRight strokeWidth={1.5} className="w-5 h-5 text-muted-foreground rotate-90" /></div>
              <div className="border border-border bg-background rounded-xl p-4 text-center font-medium flex items-center justify-center gap-2">
                <Server strokeWidth={1.5} className="w-5 h-5" /> [Dusk Servers (NO DECRYPTION KEY)]
              </div>
            </div>
          </div>

          <div className="border border-primary/20 bg-primary/5 rounded-2xl p-8 text-center max-w-4xl mx-auto shadow-none">
            <p className="text-xl md:text-2xl font-bold text-foreground leading-snug">
              We never see your passwords. We never see your seed phrases. We never store your master key.
            </p>
          </div>
        </section>

        {/* 7. USE CASES SECTION */}
        <section id="use-cases" className="border-t border-border bg-card py-32">
          <div className="container mx-auto px-6 max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-4">What People Store In Dusk.</h2>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-background border border-border rounded-2xl p-6 shadow-none">
                <Shield strokeWidth={1.5} className="w-8 h-8 text-primary mb-4" />
                <h3 className="font-bold text-lg mb-2">Crypto Investors</h3>
                <p className="text-muted-foreground text-sm">Seed phrases, hardware wallet backups, exchange credentials, and asset locations.</p>
              </div>
              <div className="bg-background border border-border rounded-2xl p-6 shadow-none">
                <Briefcase strokeWidth={1.5} className="w-8 h-8 text-primary mb-4" />
                <h3 className="font-bold text-lg mb-2">Business Owners</h3>
                <p className="text-muted-foreground text-sm">Domain access, hosting accounts, operating procedures, and administrative passwords.</p>
              </div>
              <div className="bg-background border border-border rounded-2xl p-6 shadow-none">
                <Users strokeWidth={1.5} className="w-8 h-8 text-primary mb-4" />
                <h3 className="font-bold text-lg mb-2">Families</h3>
                <p className="text-muted-foreground text-sm">Financial instructions, bank account details, bill payments, and vital document locations.</p>
              </div>
              <div className="bg-background border border-border rounded-2xl p-6 shadow-none">
                <Plane strokeWidth={1.5} className="w-8 h-8 text-primary mb-4" />
                <h3 className="font-bold text-lg mb-2">Frequent Travelers</h3>
                <p className="text-muted-foreground text-sm">Emergency information, travel insurance details, and contingency recovery plans.</p>
              </div>
              <div className="bg-background border border-border rounded-2xl p-6 shadow-none md:col-span-2 lg:col-span-1">
                <FileText strokeWidth={1.5} className="w-8 h-8 text-primary mb-4" />
                <h3 className="font-bold text-lg mb-2">Estate Planning</h3>
                <p className="text-muted-foreground text-sm">Final wishes, personal letters to loved ones, and specific inheritance instructions.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 8. FEATURE GRID */}
        <section className="container mx-auto px-6 py-32 max-w-6xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-12 gap-x-8">
            <div className="flex gap-4">
              <Lock strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">AES-256 Encryption</h4><p className="text-sm text-muted-foreground">Military-grade protection for your data.</p></div>
            </div>
            <div className="flex gap-4">
              <EyeOff strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">Zero-Knowledge Design</h4><p className="text-sm text-muted-foreground">We cannot access your encrypted files.</p></div>
            </div>
            <div className="flex gap-4">
              <Clock strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">Automated Heartbeat</h4><p className="text-sm text-muted-foreground">Set-and-forget quarterly check-ins.</p></div>
            </div>
            <div className="flex gap-4">
              <Mail strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">Email Notifications</h4><p className="text-sm text-muted-foreground">Reliable delivery of checks and warnings.</p></div>
            </div>
            <div className="flex gap-4">
              <MessageSquare strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">SMS Notifications</h4><p className="text-sm text-muted-foreground">Text messages ensure you never miss a ping.</p></div>
            </div>
            <div className="flex gap-4">
              <Users strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">Up to 5 Recipients</h4><p className="text-sm text-muted-foreground">Multi-contact routing for safe redundancy.</p></div>
            </div>
            <div className="flex gap-4">
              <Database strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">Unlimited Secure Notes</h4><p className="text-sm text-muted-foreground">Store as many records as you need.</p></div>
            </div>
            <div className="flex gap-4">
              <FileText strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">Final Wishes Storage</h4><p className="text-sm text-muted-foreground">Dedicated templates for end-of-life notes.</p></div>
            </div>
            <div className="flex gap-4">
              <Shield strokeWidth={1.5} className="w-6 h-6 text-primary shrink-0" />
              <div><h4 className="font-bold mb-1">Recovery Audit Trail</h4><p className="text-sm text-muted-foreground">Log of every access attempt.</p></div>
            </div>
          </div>
        </section>

        {/* 9. INTERACTIVE TIMELINE (How It Works) */}
        <section id="how-it-works" className="border-t border-border bg-card py-32">
          <div className="container mx-auto px-6 max-w-3xl">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-16 text-center">How It Works</h2>
            
            <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-px before:bg-border">
              
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-primary bg-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-none relative z-10">
                  <span className="text-sm font-bold text-primary">1</span>
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] border border-border bg-background p-6 rounded-2xl shadow-none">
                  <h3 className="font-bold text-foreground mb-1">Create Vault</h3>
                  <p className="text-sm text-muted-foreground">Sign up and generate your local encryption keys.</p>
                </div>
              </div>
              
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-primary bg-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-none relative z-10">
                  <span className="text-sm font-bold text-primary">2</span>
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] border border-border bg-background p-6 rounded-2xl shadow-none">
                  <h3 className="font-bold text-foreground mb-1">Add Assets</h3>
                  <p className="text-sm text-muted-foreground">Store passwords and crypto seeds securely.</p>
                </div>
              </div>
              
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-primary bg-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-none relative z-10">
                  <span className="text-sm font-bold text-primary">3</span>
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] border border-border bg-background p-6 rounded-2xl shadow-none">
                  <h3 className="font-bold text-foreground mb-1">Add Trusted Contacts</h3>
                  <p className="text-sm text-muted-foreground">Assign up to 5 emergency recipients.</p>
                </div>
              </div>

              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-muted shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-none relative z-10">
                  <Clock strokeWidth={1.5} className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] border border-border bg-background p-6 rounded-2xl shadow-none">
                  <h3 className="font-bold text-foreground mb-1">Quarterly Check-In</h3>
                  <p className="text-sm text-muted-foreground">Click the email/SMS link every 90 days to stay active.</p>
                </div>
              </div>

              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-muted shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-none relative z-10">
                  <XCircle strokeWidth={1.5} className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] border border-border bg-background p-6 rounded-2xl shadow-none">
                  <h3 className="font-bold text-foreground mb-1">No Response</h3>
                  <p className="text-sm text-muted-foreground">If you miss the warnings, the timer expires.</p>
                </div>
              </div>

              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-primary bg-primary/10 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-none relative z-10">
                  <CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] border border-primary/30 bg-primary/5 p-6 rounded-2xl shadow-none">
                  <h3 className="font-bold text-foreground mb-1">Recovery Triggered</h3>
                  <p className="text-sm text-muted-foreground">Contacts automatically receive secure access links.</p>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* 10. WHY LIFETIME PRICING */}
        <section className="container mx-auto px-6 py-32 max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-6">No Subscriptions. Ever.</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Most end-of-life services charge indefinitely for something you may use once. Dusk is different. Pay once. Protect your legacy forever.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="border border-border bg-card rounded-2xl p-8 shadow-none">
              <h3 className="text-lg font-bold text-muted-foreground mb-6 uppercase tracking-wider">Typical SaaS</h3>
              <ul className="space-y-4">
                <li className="flex items-center gap-3 text-muted-foreground"><XCircle strokeWidth={1.5} className="w-5 h-5 text-muted-foreground/50" /> Monthly fee</li>
                <li className="flex items-center gap-3 text-muted-foreground"><XCircle strokeWidth={1.5} className="w-5 h-5 text-muted-foreground/50" /> Ongoing billing</li>
                <li className="flex items-center gap-3 text-muted-foreground"><XCircle strokeWidth={1.5} className="w-5 h-5 text-muted-foreground/50" /> Continuous payments</li>
              </ul>
            </div>
            <div className="border border-primary bg-card rounded-2xl p-8 shadow-none relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-bl-lg">THE DUSK WAY</div>
              <h3 className="text-lg font-bold text-foreground mb-6 uppercase tracking-wider">Dusk</h3>
              <ul className="space-y-4">
                <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> One-time payment</li>
                <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Lifetime access</li>
                <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> No renewal anxiety</li>
              </ul>
            </div>
          </div>
        </section>

        {/* 11. FOUNDER PHILOSOPHY */}
        <section className="border-y border-border bg-card py-24">
          <div className="container mx-auto px-6 max-w-3xl text-center">
            <h2 className="text-sm font-bold text-primary uppercase tracking-widest mb-8">Why We Built Dusk</h2>
            <blockquote className="text-2xl md:text-3xl font-medium text-foreground leading-relaxed">
              "Every year, millions in crypto and digital assets become inaccessible because nobody knows where credentials are stored. Dusk was created to solve a simple problem: Your digital legacy should survive you."
            </blockquote>
          </div>
        </section>

        {/* 12. SOCIAL PROOF (Placeholder) */}
        <section className="container mx-auto px-6 py-32 max-w-6xl text-center">
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-12">Designed For The Modern Digital Estate.</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="border border-border bg-card rounded-2xl p-8 shadow-none h-48 flex items-center justify-center opacity-50">
              <span className="text-muted-foreground text-sm font-medium">User Testimonial Space</span>
            </div>
            <div className="border border-border bg-card rounded-2xl p-8 shadow-none h-48 flex items-center justify-center opacity-50">
              <span className="text-muted-foreground text-sm font-medium">User Testimonial Space</span>
            </div>
            <div className="border border-border bg-card rounded-2xl p-8 shadow-none h-48 flex items-center justify-center opacity-50">
              <span className="text-muted-foreground text-sm font-medium">User Testimonial Space</span>
            </div>
          </div>
        </section>

        {/* 13. EXPANDED PRICING SECTION */}
        <section id="pricing" className="border-t border-border bg-card py-32">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-4">One Payment. Lifetime Protection.</h2>
            </div>

            <div className="max-w-lg mx-auto bg-background border border-primary rounded-2xl shadow-none overflow-hidden flex flex-col">
              <div className="p-10 text-center border-b border-border">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-6xl font-extrabold tracking-tighter text-foreground">$50</span>
                </div>
                <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">/ Pay Once</span>
              </div>
              
              <div className="p-10 flex-1 flex flex-col">
                <ul className="space-y-5 mb-10 text-left flex-1">
                  <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> AES-256 Encryption</li>
                  <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Unlimited Vault Entries</li>
                  <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> 5 Emergency Contacts</li>
                  <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Email + SMS Monitoring</li>
                  <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Automatic Recovery Workflow</li>
                  <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> Lifetime Updates</li>
                  <li className="flex items-center gap-3 font-medium"><CheckCircle2 strokeWidth={1.5} className="w-5 h-5 text-primary" /> No Monthly Fees</li>
                </ul>
                
                <button 
                  onClick={handleCheckout} 
                  disabled={isLoading}
                  className="bg-primary text-primary-foreground hover:bg-emerald-700 dark:hover:bg-[#00FFA3]/80 font-semibold transition-colors w-full rounded-md h-14 text-base shadow-none"
                >
                  {isLoading ? "Redirecting..." : "Create Lifetime Vault"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 14. EXPANDED FAQ */}
        <section id="faq" className="container mx-auto px-6 py-32 max-w-3xl">
          <h2 className="text-3xl md:text-5xl font-extrabold tracking-tighter mb-12 text-center">Frequently Asked Questions</h2>
          
          <Accordion className="w-full space-y-4">
            <AccordionItem value="item-1" className="bg-card border border-border rounded-2xl px-6 shadow-none">
              <AccordionTrigger className="text-base md:text-lg font-bold hover:no-underline py-6">Can Dusk recover my master password?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                No. We use zero-knowledge encryption. If you lose your master password, we cannot reset it.
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-2" className="bg-card border border-border rounded-2xl px-6 shadow-none">
              <AccordionTrigger className="text-base md:text-lg font-bold hover:no-underline py-6">What if Dusk shuts down?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                Our infrastructure is built on highly resilient cloud providers, and your one-time fee secures an escrowed operational fund. Additionally, we provide an open-source local decryption tool so your contacts can always decrypt their payload even if our servers go offline.
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-3" className="bg-card border border-border rounded-2xl px-6 shadow-none">
              <AccordionTrigger className="text-base md:text-lg font-bold hover:no-underline py-6">What if my contact changes email?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                You can update your emergency contacts at any time from your dashboard.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-4" className="bg-card border border-border rounded-2xl px-6 shadow-none">
              <AccordionTrigger className="text-base md:text-lg font-bold hover:no-underline py-6">Can I store crypto seed phrases?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                Yes. Everything is encrypted locally before touching our database.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-5" className="bg-card border border-border rounded-2xl px-6 shadow-none">
              <AccordionTrigger className="text-base md:text-lg font-bold hover:no-underline py-6">How secure is the encryption?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                We use AES-256 client-side encryption, the same standard used by militaries and banks.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        {/* 15. FINAL CTA */}
        <section className="bg-background border-t border-border py-32 relative overflow-hidden">
          {/* Faint glow in dark mode */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#00FFA3] opacity-[0.05] blur-[100px] rounded-full pointer-events-none hidden dark:block -z-10" />
          
          <div className="container mx-auto px-6 text-center max-w-3xl relative z-10">
            <h2 className="text-4xl md:text-6xl font-extrabold tracking-tighter text-foreground mb-8">Don't Leave Your Digital Legacy To Chance.</h2>
            <p className="text-xl text-muted-foreground mb-12">
              Create your encrypted vault today and ensure your loved ones can access what matters when it matters most.
            </p>
            <Link href="/register" className="inline-block bg-primary text-primary-foreground hover:bg-emerald-700 dark:hover:bg-[#00FFA3]/80 font-semibold transition-colors px-10 py-5 rounded-md text-lg shadow-none">
              Get Started Free
            </Link>
          </div>
        </section>
      </main>

      {/* 16. FOOTER */}
      <footer className="bg-card border-t border-border py-16">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-16">
            <div className="md:col-span-1">
              <span className="text-2xl font-bold tracking-tight mb-4 block text-foreground">Dusk</span>
              <p className="text-muted-foreground text-sm">
                Cryptographically secured digital estate management. 
                Pass on your legacy safely.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold mb-4 text-foreground">Product</h4>
              <ul className="space-y-3">
                <li><Link href="#features" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Features</Link></li>
                <li><Link href="#security" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Security</Link></li>
                <li><Link href="#pricing" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Pricing</Link></li>
                <li><Link href="#faq" className="text-muted-foreground hover:text-foreground text-sm transition-colors">FAQ</Link></li>
                <li><Link href="#" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Whitepaper</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold mb-4 text-foreground">Legal</h4>
              <ul className="space-y-3">
                <li><Link href="#" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Privacy Policy</Link></li>
                <li><Link href="#" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Terms of Service</Link></li>
                <li><Link href="#" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Data Processing</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold mb-4 text-foreground">Support</h4>
              <ul className="space-y-3">
                <li><Link href="#" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Status Page</Link></li>
                <li><Link href="#" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Bug Bounty</Link></li>
                <li><Link href="#" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Contact</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-border text-sm text-muted-foreground flex items-center justify-between">
            <span>© 2026 Dusk Technologies. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
