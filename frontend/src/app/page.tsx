import Link from "next/link";

// Placeholder until M6 builds the Today screen.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 font-sans">
      <h1 className="text-3xl font-semibold">Future You</h1>
      <p className="text-zinc-600">Meet the you of 2031, then take the first step today.</p>
      <Link href="/dev" className="rounded-full border px-4 py-2 text-sm">
        API contract check
      </Link>
    </main>
  );
}
