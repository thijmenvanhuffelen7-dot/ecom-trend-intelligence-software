import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { authMode } from "@/lib/auth/server";
import { Logo } from "@/components/shell/logo";

export default function SignInPage() {
  if (authMode() !== "clerk") redirect("/login");
  return (
    <div className="grid min-h-dvh place-items-center bg-frame px-4">
      <div className="flex flex-col items-center gap-8">
        <Logo light />
        <SignIn />
      </div>
    </div>
  );
}
