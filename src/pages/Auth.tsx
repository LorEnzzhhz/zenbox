import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.svg";
import {
  ArrowRight,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Shield,
} from "lucide-react";

/** Branded Gmail glyph (inline SVG — no brand-icon dependency needed). */
function GmailGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

/** Branded Facebook glyph (inline SVG). */
function FacebookGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.073C24 5.406 18.627 0 12 0S0 5.406 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.971h-1.513c-1.491 0-1.956.931-1.956 1.886v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"
      />
    </svg>
  );
}
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const redeem = useMutation(api.admin.redeemGuest);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(searchParams.get("returnTo"), redirectAfterAuth);

  const [tab, setTab] = useState<"guest" | "developer">("guest");

  // Developer (email OTP) state
  const [emailStep, setEmailStep] = useState<"email" | { email: string }>("email");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Developer (email + password) state
  const [devMode, setDevMode] = useState<"code" | "password">("code");
  const [pwMode, setPwMode] = useState<"signin" | "signup">("signin");

  // Guest (access code) state
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate(redirect);
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setEmailStep({ email: formData.get("email") as string });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the code. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch {
      setError("The verification code is incorrect.");
      setOtp("");
      setIsLoading(false);
    }
  };

  /** Email + password login ("Gmail with password"). */
  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("password", formData);
      navigate(redirect);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.includes("not registered")
            ? "No account with that email yet — switch to Create account."
            : err.message.includes("incorrect")
              ? "Wrong password. Try again."
              : err.message
          : "Could not sign in with that email and password.",
      );
      setIsLoading(false);
    }
  };

  /** Guest: anonymous sign-in, then redeem the access code. */
  const handleGuest = async () => {
    const trimmed = code.trim();
    if (!trimmed || redeeming) return;
    setRedeeming(true);
    setError(null);
    try {
      if (!isAuthenticated) await signIn("anonymous");
      // The token lands right after sign-in; give it a moment if needed.
      let lastErr: unknown = null;
      for (let i = 0; i < 4; i++) {
        try {
          await redeem({ code: trimmed });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (lastErr) throw lastErr;
      navigate(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not redeem the code.");
      setRedeeming(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <Card className="w-full max-w-md border-border/80 pb-0 shadow-none">
          <CardHeader className="text-center">
            <div className="flex justify-center">
              <img
                src={logo}
                alt="Zenbox"
                width={40}
                height={40}
                className="mb-5 mt-2 cursor-pointer opacity-90 transition-opacity hover:opacity-100"
                onClick={() => navigate("/")}
              />
            </div>
            <CardTitle className="text-lg tracking-tight">Welcome to Zenbox</CardTitle>
            <CardDescription>Free-model AI studio — chat, code, images, writing</CardDescription>
          </CardHeader>

          <CardContent>
            {/* Social login — Gmail & Facebook use the custom code sender:
                a one-time code is emailed straight to the account's inbox. */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-2 text-[13px]"
                onClick={() => {
                  setTab("developer");
                  setDevMode("code");
                }}
              >
                <GmailGlyph className="size-4" />
                Gmail
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-2 text-[13px]"
                onClick={() => {
                  setTab("developer");
                  setDevMode("code");
                }}
              >
                <FacebookGlyph className="size-4" />
                Facebook
              </Button>
            </div>
            <div className="mb-4 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground/60">
              <span className="h-px flex-1 bg-border/70" />
              or
              <span className="h-px flex-1 bg-border/70" />
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as "guest" | "developer")}>
              <TabsList className="grid w-full grid-cols-2 rounded-sm">
                <TabsTrigger value="guest" className="rounded-sm text-xs">
                  <KeyRound className="mr-1.5 size-3.5" />
                  I have a code
                </TabsTrigger>
                <TabsTrigger value="developer" className="rounded-sm text-xs">
                  <Shield className="mr-1.5 size-3.5" />
                  Developer
                </TabsTrigger>
              </TabsList>

              {/* Guest */}
              <TabsContent value="guest" className="mt-4">
                <p className="text-[13px] leading-6 text-muted-foreground">
                  Enter the access code your developer gave you to open the studio.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="ZB-XXXX-XXXX"
                    className="h-10 font-mono text-sm uppercase"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={redeeming}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleGuest();
                    }}
                  />
                  <Button
                    type="button"
                    className="h-10 shrink-0 gap-1.5 text-sm"
                    onClick={() => void handleGuest()}
                    disabled={redeeming || !code.trim()}
                  >
                    {redeeming ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  </Button>
                </div>
              </TabsContent>

              {/* Developer */}
              <TabsContent value="developer" className="mt-4">
                <div className="mb-4 grid grid-cols-2 gap-1 rounded-sm bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => setDevMode("code")}
                    className={cn(
                      "rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
                      devMode === "code"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Mail className="mr-1.5 inline size-3" />
                    One-time code
                  </button>
                  <button
                    type="button"
                    onClick={() => setDevMode("password")}
                    className={cn(
                      "rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
                      devMode === "password"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Lock className="mr-1.5 inline size-3" />
                    Password
                  </button>
                </div>

                {devMode === "password" ? (
                  <form onSubmit={handlePasswordSubmit}>
                    <p className="text-[13px] leading-6 text-muted-foreground">
                      {pwMode === "signin"
                        ? "Sign in with your email and password."
                        : "Create an account with your email and a password."}
                    </p>
                    <div className="mt-3 space-y-2">
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 size-4 text-muted-foreground" />
                        <Input
                          name="email"
                          placeholder="name@gmail.com"
                          type="email"
                          className="h-10 pl-9 text-sm"
                          disabled={isLoading}
                          required
                        />
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 size-4 text-muted-foreground" />
                        <Input
                          name="password"
                          placeholder="••••••••"
                          type="password"
                          className="h-10 pl-9 text-sm"
                          disabled={isLoading}
                          required
                          minLength={8}
                        />
                      </div>
                      {pwMode === "signup" && (
                        <Input
                          name="name"
                          placeholder="Your name (optional)"
                          className="h-10 text-sm"
                          disabled={isLoading}
                        />
                      )}
                    </div>
                    <Button
                      type="submit"
                      className="mt-4 w-full"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : pwMode === "signin" ? (
                        <>
                          Sign in
                          <ArrowRight className="ml-2 size-4" />
                        </>
                      ) : (
                        <>
                          Create account
                          <ArrowRight className="ml-2 size-4" />
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-2 w-full text-muted-foreground"
                      onClick={() => setPwMode(pwMode === "signin" ? "signup" : "signin")}
                      disabled={isLoading}
                    >
                      {pwMode === "signin"
                        ? "No account? Create one"
                        : "Already have an account? Sign in"}
                    </Button>
                  </form>
                ) : emailStep === "email" ? (
                  <form onSubmit={handleEmailSubmit}>
                    <p className="text-[13px] leading-6 text-muted-foreground">
                      Sign in with your Gmail or Facebook email — Zenbox's custom code sender
                      emails a one-time code straight to that inbox.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="relative flex-1">
                        <Mail className="absolute left-3 top-3 size-4 text-muted-foreground" />
                        <Input
                          name="email"
                          placeholder="name@gmail.com or facebook email"
                          type="email"
                          className="h-10 pl-9 text-sm"
                          disabled={isLoading}
                          required
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="outline"
                        size="icon"
                        className="size-10"
                        disabled={isLoading}
                      >
                        {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleOtpSubmit}>
                    <p className="text-[13px] leading-6 text-muted-foreground">
                      We sent a 6-digit code to <span className="font-medium text-foreground">{emailStep.email}</span>
                    </p>
                    <input type="hidden" name="email" value={emailStep.email} />
                    <input type="hidden" name="code" value={otp} />
                    <div className="mt-3 flex justify-center">
                      <InputOTP
                        value={otp}
                        onChange={setOtp}
                        maxLength={6}
                        disabled={isLoading}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                            (e.target as HTMLElement).closest("form")?.requestSubmit();
                          }
                        }}
                      >
                        <InputOTPGroup>
                          {Array.from({ length: 6 }).map((_, index) => (
                            <InputOTPSlot key={index} index={index} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <Button
                      type="submit"
                      className="mt-4 w-full"
                      disabled={isLoading || otp.length !== 6}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Verifying…
                        </>
                      ) : (
                        <>
                          Verify code
                          <ArrowRight className="ml-2 size-4" />
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-2 w-full text-muted-foreground"
                      onClick={() => setEmailStep("email")}
                      disabled={isLoading}
                    >
                      Use a different email
                    </Button>
                  </form>
                )}
              </TabsContent>
            </Tabs>

            {error && (
              <p className={cn("mt-3 rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive")}>
                {error}
              </p>
            )}
          </CardContent>

          <div className="rounded-b-md border-t bg-muted px-6 py-4 text-center text-xs text-muted-foreground">
            <span className="font-semibold tracking-[0.25em]">ZENBOX</span>
            <span className="mx-2 text-muted-foreground/50">·</span>
            free models · no credits
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
