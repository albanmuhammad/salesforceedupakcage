// export default function Home() {
//   return (
//     <main className="min-h-screen">
//       {/* Embed aplikasi lain */}
//       <iframe
//         src="https://metro-seven-web-to-lead.vercel.app/index.html"
//         className="w-full h-[90vh] border-0"
//         allow="clipboard-read; clipboard-write; fullscreen"
//       />
//       {/* Fallback CTA */}
//       <div className="p-4 text-center">
//         <a
//           href="/login"
//           className="inline-block rounded bg-black text-white px-4 py-2"
//         >
//           Login di sini
//         </a>
//       </div>
//     </main>
//   );
// }

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