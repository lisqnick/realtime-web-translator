import { TranslatorShell } from "@/components/translator-shell";
import { publicRuntimeDefaults } from "@/config/env";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <TranslatorShell runtimeDefaults={publicRuntimeDefaults} />
      </div>
    </main>
  );
}
