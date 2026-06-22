"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Verdict = {
  umbrella: boolean;
  maxChance: number;
  totalRain: number;
  summary: string;
  hours: { time: string; chance: number; rain: number; temp: number }[];
};
type Location = { id: number; name: string; verdict: Verdict | null; error: string | null };

export default function Home() {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = (localStorage.getItem("theme") as "light" | "dark") || "light";
    setTheme(saved);
    init();
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  async function init() {
    const res = await fetch("/api/auth/me");
    const { user } = await res.json();
    if (!user) {
      router.replace("/signin");
      return;
    }
    setEmail(user.email);
    setReady(true);
    load();
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/signin");
  }

  async function load() {
    try {
      const res = await fetch("/api/locations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLocations(data.locations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  async function add() {
    if (!city.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: city }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCity("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: number) {
    await fetch(`/api/locations?id=${id}`, { method: "DELETE" });
    setLocations((prev) => prev.filter((l) => l.id !== id));
  }

  if (!ready) {
    return <div className="container"><p className="empty">Loading…</p></div>;
  }

  return (
    <div className="container">
      <header className="header">
        <div className="brand">
          ☂️ Umbrella <span>Alert</span>
        </div>
        <div className="user-row">
          <span className="user-email">{email}</span>
          <button className="toggle" onClick={toggleTheme}>
            {theme === "light" ? "🌙 Dark" : "☀️ Light"}
          </button>
          <button className="link-btn" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="addbar">
        <input
          className="input"
          placeholder="Add a city (e.g. London, Mumbai, Tokyo)"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn" onClick={add} disabled={loading}>
          {loading ? "…" : "Add"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {locations.length === 0 && !error && (
        <p className="empty">No cities yet — add one above to see if you'll need an umbrella today.</p>
      )}

      {locations.map((loc) => {
        const v = loc.verdict;
        const peak = v ? Math.max(1, ...v.hours.map((h) => h.chance)) : 1;
        return (
          <div className="card" key={loc.id}>
            <div className="card-top">
              <h2 className="loc-name">{loc.name}</h2>
              <button className="remove" onClick={() => remove(loc.id)} aria-label="Remove">
                ×
              </button>
            </div>
            {loc.error && <p className="error">{loc.error}</p>}
            {v && (
              <>
                <p className={`verdict ${v.umbrella ? "rain" : "clear"}`}>
                  {v.umbrella ? "☂️ Bring an umbrella" : "☀️ You're fine"}
                </p>
                <p className="summary">{v.summary}</p>
                <div className="bars" title="Hourly chance of rain">
                  {v.hours.map((h, i) => (
                    <div
                      key={i}
                      className="bar"
                      style={{ height: `${(h.chance / peak) * 100}%` }}
                      title={`${new Date(h.time).getHours()}:00 — ${h.chance}%`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
