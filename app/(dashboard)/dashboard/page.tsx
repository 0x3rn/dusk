"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, Clock, Plus, Phone, Mail, User, ShieldAlert, Key, LogOut, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import Link from "next/link";

// Mock Data
const MOCK_CONTACTS = [
  { id: 1, name: "Sarah Connor", email: "sarah@example.com", phone: "+1 555 0123" },
  { id: 2, name: "John Connor", email: "john@example.com", phone: "+1 555 0199" },
];

const MOCK_SECRETS = [
  { id: 1, title: "Main Hardware Wallet", type: "Seed Phrase", date: "2024-05-12" },
  { id: 2, title: "Chase Bank Accounts", type: "Credentials", date: "2024-05-15" },
];

export default function DashboardPage() {
  const [daysRemaining, setDaysRemaining] = useState(89);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        router.push("/login");
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);

  const handleCheckIn = () => {
    setDaysRemaining(90);
  };

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Dashboard Nav */}
      <nav className="border-b border-border bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Shield strokeWidth={1.5} className="w-4 h-4 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-tight">Dusk.</span>
          </Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <span className="text-sm text-muted-foreground hidden sm:block truncate max-w-[200px]">
              {user.displayName || user.email}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={handleSignOut}
            >
              <LogOut strokeWidth={1.5} className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-12 max-w-6xl space-y-8">

        {/* Status Panel */}
        <Card className="border-primary/20 bg-card overflow-hidden relative">
          <div className="absolute right-0 top-0 w-64 h-64 bg-primary/10 rounded-full blur-[80px] -z-10" />
          <CardContent className="p-8 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-full border-4 border-primary/30 flex items-center justify-center relative bg-background">
                <Clock strokeWidth={1.5} className="w-8 h-8 text-primary" />
                <svg className="absolute inset-0 w-full h-full -rotate-90">
                  <circle cx="50%" cy="50%" r="38" className="stroke-primary/20 fill-none" strokeWidth="4" />
                  <circle cx="50%" cy="50%" r="38" className="stroke-primary fill-none transition-all duration-1000" strokeWidth="4" strokeDasharray="238" strokeDashoffset={238 - (238 * (daysRemaining / 90))} />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-1">Status: Active</h2>
                <p className="text-muted-foreground">
                  <span className="text-primary font-mono text-xl mr-2">{daysRemaining}</span>
                  days until Dead Man&apos;s Switch triggers.
                </p>
              </div>
            </div>
            <Button size="lg" onClick={handleCheckIn} className="h-14 px-8 rounded-full w-full md:w-auto">
              I am alive (Check In)
            </Button>
          </CardContent>
        </Card>

        {/* Main Content Tabs */}
        <Tabs defaultValue="vault" className="w-full">
          <TabsList className="w-full justify-start border-b border-border rounded-none bg-transparent h-auto p-0 space-x-6">
            <TabsTrigger value="vault" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 text-base data-[state=active]:shadow-none">
              <Key strokeWidth={1.5} className="w-4 h-4 mr-2" /> Digital Vault
            </TabsTrigger>
            <TabsTrigger value="contacts" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 text-base data-[state=active]:shadow-none">
              <User strokeWidth={1.5} className="w-4 h-4 mr-2" /> Emergency Contacts
            </TabsTrigger>
          </TabsList>

          {/* Vault Section */}
          <TabsContent value="vault" className="mt-8 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">Stored Secrets</h3>
                <p className="text-muted-foreground text-sm">Encrypted client-side. Zero-knowledge guaranteed.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Add New Secret Form */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ShieldAlert strokeWidth={1.5} className="w-5 h-5 text-primary" />
                    Add to Vault
                  </CardTitle>
                  <CardDescription>All text is AES-256 encrypted before leaving your browser.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Title</label>
                    <Input placeholder="e.g. Ledger Nano Seed Phrase" className="bg-transparent border-border" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Secret Data</label>
                    <Textarea placeholder="Enter your passwords, seeds, or instructions here..." className="bg-transparent border-border h-32 resize-none" />
                  </div>
                  <Button className="w-full">
                    <Lock strokeWidth={1.5} className="w-4 h-4 mr-2" />
                    Encrypt and Save
                  </Button>
                </CardContent>
              </Card>

              {/* List of Secrets */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Encrypted Items</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {MOCK_SECRETS.map((secret) => (
                      <div key={secret.id} className="flex items-center justify-between p-4 rounded-xl border border-border bg-background/50 hover:border-primary/30 transition-colors cursor-pointer group">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Lock strokeWidth={1.5} className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{secret.title}</p>
                            <p className="text-xs text-muted-foreground">{secret.type}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="border-border text-xs">Encrypted</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Emergency Contacts Section */}
          <TabsContent value="contacts" className="mt-8 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">Designated Recipients</h3>
                <p className="text-muted-foreground text-sm">Who gets access when the switch triggers.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <Card className="md:col-span-1 bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Add Contact</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Full Name</label>
                    <div className="relative">
                      <User strokeWidth={1.5} className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Jane Doe" className="pl-9 bg-transparent border-border" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email Address</label>
                    <div className="relative">
                      <Mail strokeWidth={1.5} className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="jane@example.com" type="email" className="pl-9 bg-transparent border-border" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Phone Number</label>
                    <div className="relative">
                      <Phone strokeWidth={1.5} className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="+1 (555) 000-0000" className="pl-9 bg-transparent border-border" />
                    </div>
                  </div>
                  <Button className="w-full mt-2"><Plus strokeWidth={1.5} className="w-4 h-4 mr-2" /> Add Contact</Button>
                </CardContent>
              </Card>

              <Card className="md:col-span-2 bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Active Contacts</CardTitle>
                  <CardDescription>They have securely received their unique URL hashes.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MOCK_CONTACTS.map((contact) => (
                        <TableRow key={contact.id} className="border-border hover:bg-muted/50">
                          <TableCell className="font-medium">{contact.name}</TableCell>
                          <TableCell className="text-muted-foreground">{contact.email}</TableCell>
                          <TableCell className="text-muted-foreground">{contact.phone}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="border-green-500/30 text-green-500 bg-green-500/10">Verified</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
