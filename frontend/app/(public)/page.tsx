import { MeetingsView } from "@/components/meetings-view";

export const metadata = { title: "Meetings | Spry" };

// The home page is the meetings page: lab 2 has no sign-in, so there is
// nothing to show before it. /meetings serves the same view.
export default function HomePage() {
  return <MeetingsView />;
}
