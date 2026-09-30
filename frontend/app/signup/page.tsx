import { Suspense } from "react";

import { SignupForm } from "@/components/signup-form";

export const metadata = { title: "Sign up | Spry" };

export default function SignupPage() {
  // useSearchParams needs a Suspense boundary to prerender.
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
