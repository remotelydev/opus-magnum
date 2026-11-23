import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Input, Label } from "@opus-magnum/dentaplus-ui/components/field";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/20/solid";
import { useState, type FormEvent } from "react";
import { api, type User } from "../lib/api.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="relative flex h-full overflow-auto bg-background p-4">
      <ThemeToggle className="absolute top-3 right-3 text-muted-foreground" />
      <form onSubmit={submit} className="m-auto w-full max-w-xs space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-primary">Horarium · DentaPlus+</h1>
        <div className="space-y-1">
          <Label htmlFor="login">Login</Label>
          <Input
            id="login"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Hasło</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute inset-y-0 right-1 my-auto text-muted-foreground"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
              aria-pressed={showPassword}
              title={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
            >
              {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
            </Button>
          </div>
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
