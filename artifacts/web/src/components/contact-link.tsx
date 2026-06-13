import { cn } from "@/lib/utils";

// Renders an email address as an interactive mailto link. Stops the click from
// bubbling so it works inside clickable rows/cards.
export function EmailLink({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  return (
    <a
      href={`mailto:${email}`}
      onClick={(e) => e.stopPropagation()}
      className={cn("text-primary hover:underline", className)}
    >
      {email}
    </a>
  );
}

// Renders a phone number as an interactive tel link. The displayed text keeps
// the original formatting; the href is normalised to digits and a leading "+".
export function PhoneLink({
  phone,
  className,
}: {
  phone: string;
  className?: string;
}) {
  const tel = phone.replace(/[^\d+]/g, "");
  return (
    <a
      href={`tel:${tel}`}
      onClick={(e) => e.stopPropagation()}
      className={cn("text-primary hover:underline", className)}
    >
      {phone}
    </a>
  );
}
