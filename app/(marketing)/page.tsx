"use client";

import { useState } from "react";
import { Shield, Clock, Users, CheckCircle2 } from "lucide-react";
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
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50">
      
      {/* HEADER / NAVBAR */}
      <nav className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-xl font-bold tracking-tight">
              Dusk
            </Link>
            <div className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-500 dark:text-neutral-400">
              <Link href="#features" className="hover:text-neutral-900 dark:hover:text-neutral-50">Features</Link>
              <Link href="#how-it-works" className="hover:text-neutral-900 dark:hover:text-neutral-50">How It Works</Link>
              <Link href="#pricing" className="hover:text-neutral-900 dark:hover:text-neutral-50">Pricing</Link>
              <Link href="#faq" className="hover:text-neutral-900 dark:hover:text-neutral-50">FAQ</Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link href="/login" className="text-sm font-medium hover:underline hidden sm:block">
              Sign In
            </Link>
            <button className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400 font-semibold transition-colors px-4 py-2 rounded-md text-sm">
              Create Vault
            </button>
          </div>
        </div>
      </nav>

      <main>
        {/* HERO SECTION */}
        <section className="container mx-auto px-6 pt-32 pb-24 text-center max-w-5xl">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter leading-tight mb-8">
            Your Digital Legacy, Cryptographically Secured.
          </h1>
          <p className="text-xl text-neutral-500 dark:text-neutral-400 mb-10 max-w-3xl mx-auto leading-snug">
            The ultimate Dead Man’s Switch. We ensure your loved ones recover your crypto wallets, passwords, and final wishes when you are no longer here. Zero-knowledge architecture. One simple lifetime fee.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
            <button className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400 font-semibold transition-colors px-8 py-4 rounded-md text-base w-full sm:w-auto">
              Secure Your Vault — $50 Lifetime
            </button>
            <button className="border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-900 dark:text-white rounded-md font-medium transition-colors px-8 py-4 text-base w-full sm:w-auto">
              Read the Security Whitepaper
            </button>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden mx-auto w-full aspect-[16/9] md:aspect-[21/9]">
            <img 
              src="https://images.unsplash.com/photo-1563206767-5b18f218e8de?auto=format&fit=crop&w=2000&q=80" 
              alt="Vault Door" 
              className="w-full h-full object-cover"
            />
          </div>
        </section>

        {/* SOCIAL PROOF BANNER */}
        <section className="border-y border-neutral-200 dark:border-neutral-800 py-6">
          <div className="container mx-auto px-6 text-center">
            <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 tracking-[0.2em] uppercase">
              SECURING MILLIONS IN DIGITAL ASSETS AND FINAL WISHES
            </p>
          </div>
        </section>

        {/* THE PROBLEM/SOLUTION SECTION (Feature Grid) */}
        <section id="features" className="container mx-auto px-6 py-32">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">Total Security. Zero Human Intervention.</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            <div className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none p-8">
              <div className="mb-6 border border-neutral-200 dark:border-neutral-800 w-12 h-12 rounded-md flex items-center justify-center bg-white dark:bg-neutral-950">
                <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
              </div>
              <h3 className="text-xl font-bold tracking-tight mb-3">AES-256 Client-Side Encryption</h3>
              <p className="text-neutral-500 dark:text-neutral-400 leading-snug">
                Your vault is encrypted directly in your browser. We never see your master key, and we can never read your data. True zero-knowledge architecture.
              </p>
            </div>

            <div className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none p-8">
              <div className="mb-6 border border-neutral-200 dark:border-neutral-800 w-12 h-12 rounded-md flex items-center justify-center bg-white dark:bg-neutral-950">
                <Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
              </div>
              <h3 className="text-xl font-bold tracking-tight mb-3">Automated Contingency</h3>
              <p className="text-neutral-500 dark:text-neutral-400 leading-snug">
                If you fail to check in via our secure email or SMS link every 90 days, our system assumes the worst and automatically triggers your contingency plan.
              </p>
            </div>

            <div className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none p-8">
              <div className="mb-6 border border-neutral-200 dark:border-neutral-800 w-12 h-12 rounded-md flex items-center justify-center bg-white dark:bg-neutral-950">
                <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
              </div>
              <h3 className="text-xl font-bold tracking-tight mb-3">Multi-Recipient Routing</h3>
              <p className="text-neutral-500 dark:text-neutral-400 leading-snug">
                Designate up to 5 emergency contacts. When the switch triggers, they securely receive the decryption keys required to open your vault.
              </p>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="border-t border-neutral-200 dark:border-neutral-800 py-32">
          <div className="container mx-auto px-6 max-w-4xl">
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tighter mb-16 text-center">How Dusk Protects Your Legacy</h2>
            
            <div className="space-y-6">
              <div className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none p-8">
                <h3 className="text-xl font-bold tracking-tight mb-2">1. Encrypt Your Assets.</h3>
                <p className="text-neutral-500 dark:text-neutral-400">Store seed phrases, PINs, and documents. Everything is locked with military-grade encryption.</p>
              </div>

              <div className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none p-8">
                <h3 className="text-xl font-bold tracking-tight mb-2">2. The Heartbeat Check.</h3>
                <p className="text-neutral-500 dark:text-neutral-400">We ping you every 3 months. Click a single button to confirm you are alive and reset the timer.</p>
              </div>

              <div className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none p-8">
                <h3 className="text-xl font-bold tracking-tight mb-2">3. The Handover.</h3>
                <p className="text-neutral-500 dark:text-neutral-400">If you miss your check-in, Dusk automatically emails your designated contacts with secure access to your decrypted files.</p>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING SECTION */}
        <section id="pricing" className="container mx-auto px-6 py-32">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tighter mb-4">No Subscriptions. Just Peace of Mind.</h2>
            <p className="text-xl text-neutral-500 dark:text-neutral-400">End-of-life planning shouldn't come with a monthly bill.</p>
          </div>

          <div className="max-w-md mx-auto bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none overflow-hidden flex flex-col">
            <div className="p-10 text-center border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="text-6xl font-extrabold tracking-tighter">$50</span>
              </div>
              <span className="text-sm font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-widest">Lifetime</span>
            </div>
            
            <div className="p-10 flex-1 flex flex-col">
              <ul className="space-y-6 mb-10 text-left flex-1">
                <li className="flex items-center gap-3 font-medium"><CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> Client-Side AES-256 Encryption</li>
                <li className="flex items-center gap-3 font-medium"><CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> 5 Emergency Contacts</li>
                <li className="flex items-center gap-3 font-medium"><CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> Email & SMS Heartbeat Triggers</li>
                <li className="flex items-center gap-3 font-medium"><CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> Unlimited Secure Text Storage</li>
                <li className="flex items-center gap-3 font-medium"><CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" /> 24/7 Automated Monitoring</li>
              </ul>
              
              <button 
                onClick={handleCheckout} 
                disabled={isLoading}
                className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400 font-semibold transition-colors w-full rounded-md h-14 text-base"
              >
                {isLoading ? "Redirecting..." : "Activate Lifetime Vault"}
              </button>
            </div>
          </div>
        </section>

        {/* FAQ SECTION */}
        <section id="faq" className="border-t border-neutral-200 dark:border-neutral-800 py-32">
          <div className="container mx-auto px-6 max-w-3xl">
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tighter mb-12 text-center">Frequently Asked Questions</h2>
            
            <Accordion className="w-full space-y-4">
              <AccordionItem value="item-1" className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none px-6">
                <AccordionTrigger className="text-lg font-bold hover:no-underline py-6">What happens if I just forget to check in?</AccordionTrigger>
                <AccordionContent className="text-neutral-500 dark:text-neutral-400 text-base leading-relaxed pb-6">
                  We send you multiple warnings at 14 days, 7 days, and 24 hours before triggering the vault. We use both email and SMS to ensure you don't miss it.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-2" className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none px-6">
                <AccordionTrigger className="text-lg font-bold hover:no-underline py-6">Can Dusk employees read my passwords?</AccordionTrigger>
                <AccordionContent className="text-neutral-500 dark:text-neutral-400 text-base leading-relaxed pb-6">
                  Absolutely not. Your data is encrypted on your own device before it ever reaches our servers. Without your unique master key, your vault is mathematically impossible to open.
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="item-3" className="bg-white border border-neutral-200 shadow-sm rounded-xl dark:bg-neutral-900 dark:border-neutral-800 dark:shadow-none px-6">
                <AccordionTrigger className="text-lg font-bold hover:no-underline py-6">Is it really a one-time fee?</AccordionTrigger>
                <AccordionContent className="text-neutral-500 dark:text-neutral-400 text-base leading-relaxed pb-6">
                  Yes. We use highly efficient cloud infrastructure (Firebase) that costs us fractions of a cent per user per year. A $50 flat fee ensures we can maintain your vault indefinitely.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-neutral-200 dark:border-neutral-800 py-16">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-16">
            <div className="md:col-span-1">
              <span className="text-2xl font-bold tracking-tight mb-6 block">Dusk.</span>
              <p className="text-neutral-500 text-sm">
                Cryptographically secured digital estate management. 
                Pass on your legacy safely.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold mb-4">Product</h4>
              <ul className="space-y-2">
                <li><Link href="#features" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 text-sm transition-colors">Features</Link></li>
                <li><Link href="#pricing" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 text-sm transition-colors">Pricing</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold mb-4">Legal</h4>
              <ul className="space-y-2">
                <li><Link href="#" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 text-sm transition-colors">Privacy Policy</Link></li>
                <li><Link href="#" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 text-sm transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold mb-4">Security</h4>
              <ul className="space-y-2">
                <li><Link href="#" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 text-sm transition-colors">Security Whitepaper</Link></li>
                <li><Link href="#" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-50 text-sm transition-colors">Bug Bounty</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-neutral-200 dark:border-neutral-800 text-sm text-neutral-500">
            © 2026 Dusk Technologies. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
