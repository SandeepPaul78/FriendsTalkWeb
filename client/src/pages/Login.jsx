import { useState } from "react";
import { apiRequest } from "../services/api";

function Login({ onAuthSuccess }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [otpHint, setOtpHint] = useState("");

  const requestOtp = async () => {
    setError("");
    setLoading(true);

    try {
      const response = await apiRequest("/auth/request-otp", {
        method: "POST",
        body: { phoneNumber, email },
      });

      setStep("otp");
      if (response?.debugOtp) {
        setOtpHint(`Test OTP: ${response.debugOtp}`);
      } else {
        setOtpHint("OTP sent in test mode. Check backend server terminal logs.");
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError("");
    setLoading(true);

    try {
      const response = await apiRequest("/auth/verify-otp", {
        method: "POST",
        body: { phoneNumber, otp },
      });

      onAuthSuccess({ token: response.token, user: response.user });
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      <div className="pointer-events-none absolute -left-16 top-12 h-56 w-56 rounded-full bg-sky-300/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-72 w-72 rounded-full bg-cyan-200/50 blur-3xl" />

      <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/75 p-7 shadow-[0_24px_65px_-30px_rgba(15,23,42,0.6)] backdrop-blur-xl sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Mobile OTP Login
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-slate-900">
          FriendsTalk
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter mobile number. If `OTP_PROVIDER=brevo_email`, fill your email too for OTP delivery.
        </p>

        <div className="mt-6 space-y-3">
          <input
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder="Mobile number"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            disabled={loading || step === "otp"}
          />

          <input
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            placeholder="Email for OTP (required in brevo_email mode)"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading || step === "otp"}
          />

          {step === "otp" && (
            <input
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              placeholder="Enter 6-digit OTP"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              disabled={loading}
            />
          )}

          {otpHint && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{otpHint}</p>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}

          {step === "phone" ? (
            <button
              onClick={requestOtp}
              disabled={loading || !phoneNumber.trim()}
              className="h-12 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Sending OTP..." : "Send OTP"}
            </button>
          ) : (
            <div className="space-y-2">
              <button
                onClick={verifyOtp}
                disabled={loading || otp.trim().length !== 6}
                className="h-12 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Verifying..." : "Verify OTP"}
              </button>

              <button
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setError("");
                }}
                disabled={loading}
                className="h-10 w-full rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Change Number
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;
