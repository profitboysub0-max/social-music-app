import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { toast } from "sonner";

export function SignInForm() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signUp");
  const [submitting, setSubmitting] = useState(false);

  const getErrorMessage = (error: unknown) => {
    const message = String((error as { message?: string })?.message || "");
    if (!message) {
      return "Authentication failed. Please try again.";
    }
    if (message.includes("Invalid password")) {
      return "Invalid password. Please try again.";
    }
    if (message.includes("User not found")) {
      return "No account found for this email. Try signing up first.";
    }
    if (message.includes("already exists")) {
      return "This account already exists. Try signing in instead.";
    }
    return message;
  };

  const resetAuthSession = () => {
    try {
      if (typeof window !== "undefined") {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (key && key.includes("__convexAuth")) {
            keysToRemove.push(key);
          }
        }
        for (const key of keysToRemove) {
          window.localStorage.removeItem(key);
        }
      }
      toast.success("Auth session reset. Reloading...");
      window.location.reload();
    } catch (error) {
      console.error("Failed to reset auth session:", error);
      toast.error("Couldn't reset session automatically.");
    }
  };

  return (
    <div className="max-w-md mx-auto w-full bg-white border rounded-lg p-6 shadow-sm space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          {flow === "signUp" ? "Create your account in under 30 seconds" : "Welcome back"}
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          Follow people, share songs, and build your daily listening habit.
        </p>
        <p className="mt-3 inline-flex items-center justify-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
          Sign up or sign in to use Profit Boy&apos;s Mini Player.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          const formData = new FormData(e.target as HTMLFormElement);
          formData.set("flow", flow);
          try {
            await signIn("password", formData);
          } catch (error) {
            console.error("Password auth failed:", error);
            toast.error(getErrorMessage(error));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <input
          type="email"
          name="email"
          placeholder="Email"
          required
          autoComplete="email"
          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          required
          autoComplete={flow === "signUp" ? "new-password" : "current-password"}
          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {flow === "signIn" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div className="text-center text-sm text-gray-600">
        {flow === "signIn" ? "Don't have an account? " : "Already have an account? "}
        <button
          type="button"
          className="text-blue-600 hover:text-blue-700 font-medium"
          onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
        >
          {flow === "signIn" ? "Sign up instead" : "Sign in instead"}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <hr className="flex-1 border-gray-200" />
        <span className="text-gray-500 text-sm">or</span>
        <hr className="flex-1 border-gray-200" />
      </div>

      <button
        onClick={async () => {
          try {
            setSubmitting(true);
            await signIn("anonymous");
          } catch (error) {
            console.error("Anonymous auth failed:", error);
            toast.error(getErrorMessage(error));
          } finally {
            setSubmitting(false);
          }
        }}
        disabled={submitting}
        className="w-full px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors font-medium"
      >
        Continue as guest (read-only)
      </button>

      <button
        type="button"
        onClick={resetAuthSession}
        className="w-full px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
      >
        Reset auth session
      </button>
    </div>
  );
}
