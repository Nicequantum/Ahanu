import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAhanu } from "@/lib/ahanu/store";
import { ARTICLES } from "@/lib/data/knowledge";
import { useMemo, useState } from "react";
import { Pane } from "@/components/panels/pane";

export function KnowledgePanel() {
  const articleId = useAhanu((s) => s.articleId);
  const setArticle = useAhanu((s) => s.setArticle);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = useMemo(
    () =>
      ARTICLES.filter(
        (a) =>
          !needle ||
          a.title.toLowerCase().includes(needle) ||
          a.body.toLowerCase().includes(needle) ||
          a.category.toLowerCase().includes(needle) ||
          a.tags.some((t) => t.includes(needle)),
      ),
    [needle],
  );
  const open = ARTICLES.find((a) => a.id === articleId);

  if (open) {
    return (
      <Pane title={open.title} kicker={`${open.minutes} min · ${open.category}`}>
        <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => setArticle(null)}>
          All tricks
        </Button>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {open.tags.map((t) => (
            <span key={t} className="rounded-full bg-elevated px-2 py-0.5 text-[10px] tracking-wide text-muted">
              {t}
            </span>
          ))}
        </div>
        {open.body.split("\n\n").map((p) => (
          <p key={p.slice(0, 24)} className="mb-3 text-sm leading-relaxed text-foam/90">
            {p}
          </p>
        ))}
      </Pane>
    );
  }

  return (
    <Pane title="Tricks of the Trade" kicker="Offline library">
      <Input placeholder="Search tactics, canyons, safety…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="mt-2 text-[11px] text-muted">
        {list.length} {list.length === 1 ? "article" : "articles"}
        {needle ? ` matching "${q.trim()}"` : ""}
      </p>
      {list.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No tricks match that search.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {list.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setArticle(a.id)}
                className="w-full rounded-xl bg-elevated px-3 py-3 text-left hover:bg-elevated/70"
              >
                <span className="block text-sm text-foam">{a.title}</span>
                <span className="text-[11px] text-muted">
                  {a.minutes} min · {a.category}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}
