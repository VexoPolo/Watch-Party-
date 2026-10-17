import { EntryCard } from "@/components/EntryCard";
import { SameCouchHero } from "@/components/SameCouchHero";

export default function Home() {
  return (
    <main className="flex-1">
      <SameCouchHero>
        <EntryCard />
      </SameCouchHero>
    </main>
  );
}
