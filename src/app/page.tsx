export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Embed aplikasi lain */}
      <iframe
        src="https://edudevsite.vercel.app/index.html"
        className="w-full h-[90vh] border-0"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </main>
  );
}
