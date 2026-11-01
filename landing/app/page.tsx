"use client";
import Shell from "../components/Shell";
import { Intro, Demo, Workflow, Features, Interface, Privacy, Benchmark, Ecosystem, Faq, Install } from "../components/Sections";

export default function Page() {
  return (
    <Shell>
      <Intro /><Demo /><Workflow /><Features /><Interface /><Privacy /><Benchmark /><Ecosystem /><Faq /><Install />
    </Shell>
  );
}
