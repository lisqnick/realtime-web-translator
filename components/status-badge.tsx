import type { StatusTone } from "@/types/config";
import styles from "./status-badge.module.css";

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
}

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span className={styles.badge} data-tone={tone}>
      <span className={styles.dot} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
