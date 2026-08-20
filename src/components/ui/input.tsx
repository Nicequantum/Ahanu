import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md bg-elevated px-3 text-sm text-foam shadow-[0_0_0_1px_var(--color-line)] placeholder:text-faint focus-visible:shadow-[0_0_0_1px_var(--color-sunrise)] focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-md bg-elevated px-3 py-2 text-sm text-foam shadow-[0_0_0_1px_var(--color-line)] placeholder:text-faint focus-visible:shadow-[0_0_0_1px_var(--color-sunrise)] focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}
