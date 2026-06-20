export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Dashboard navigation will go here */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
