import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label } from "@opus-magnum/dentaplus-ui/components/field";
import { useState, type FormEvent } from "react";
import { api, type User } from "../lib/api.ts";

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(login, password);
      onLogin(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex h-full items-center justify-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-primary">Horarium · DentaPlus+</h1>
        <div className="space-y-1">
          <Label htmlFor="login">Login</Label>
          <Input id="login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Hasło</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !login || !password}>
          {busy ? "Logowanie…" : "Zaloguj"}
        </Button>
      </form>
    </main>
  );
}
