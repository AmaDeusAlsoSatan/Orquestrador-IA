export interface ServerPlan {
  status: "planned";
  purpose: string;
}

export const SERVER_PLAN: ServerPlan = {
  status: "planned",
  purpose: "Future local API surface for CLI, desktop UI, and integrations."
};
