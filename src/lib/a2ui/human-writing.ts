export type A2UIMessage = {
  surfaceUpdate?: {
    surfaceId?: string;
    components?: Array<{
      id: string;
      component: Record<string, unknown>;
    }>;
  };
  dataModelUpdate?: {
    surfaceId?: string;
    path?: string;
    contents?: Array<Record<string, unknown>>;
  };
  beginRendering?: {
    surfaceId?: string;
    catalogId?: string;
    root: string;
  };
  deleteSurface?: {
    surfaceId: string;
  };
};

export type HumanWritingA2uiPayload = {
  messages: A2UIMessage[];
  surfaceId: string;
  catalogId: string;
};

export const HUMAN_WRITING_A2UI_CATALOG_ID = "a2ui.org:standard_catalog_0_8_0";
export const HUMAN_WRITING_A2UI_SURFACE_ID = "human-writing-cta";

type CtaComponentData = {
  content?: string;
  progressLabel?: string;
};

const boundString = (value: string) => ({ literalString: value });

const pickLiteralString = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { literalString?: unknown };
  return typeof record.literalString === "string" ? record.literalString : undefined;
};

export const buildHumanWritingCtaA2ui = (params: {
  content: string;
  status?: "pending" | "done";
  progressLabel?: string;
  surfaceId?: string;
  catalogId?: string;
}): HumanWritingA2uiPayload => {
  const surfaceId = params.surfaceId || HUMAN_WRITING_A2UI_SURFACE_ID;
  const catalogId = params.catalogId || HUMAN_WRITING_A2UI_CATALOG_ID;
  const subtitle =
    params.progressLabel || "Ready to detect AI and humanize your draft";
  const components = [
    {
      id: "hw-cta-title",
      component: {
        Text: {
          text: boundString(params.content),
          usageHint: "h3",
        },
      },
    },
    {
      id: "hw-cta-subtitle",
      component: {
        Text: {
          text: boundString(subtitle),
          usageHint: "caption",
        },
      },
    },
    {
      id: "hw-cta-button-label",
      component: {
        Text: {
          text: boundString("Start agent"),
        },
      },
    },
    {
      id: "hw-cta-button",
      component: {
        Button: {
          child: "hw-cta-button-label",
          primary: true,
          action: { name: "handleStartCta" },
        },
      },
    },
    {
      id: "hw-cta-column",
      component: {
        Column: {
          children: { explicitList: ["hw-cta-title", "hw-cta-subtitle", "hw-cta-button"] },
          alignment: "start",
          distribution: "start",
        },
      },
    },
    {
      id: "hw-cta-card",
      component: {
        Card: {
          child: "hw-cta-column",
        },
      },
    },
  ];

  return {
    surfaceId,
    catalogId,
    messages: [
      {
        surfaceUpdate: {
          surfaceId,
          components,
        },
      },
      {
        dataModelUpdate: {
          surfaceId,
          contents: [],
        },
      },
      {
        beginRendering: {
          surfaceId,
          catalogId,
          root: "hw-cta-card",
        },
      },
    ],
  };
};

export const extractHumanWritingCtaFromA2ui = (payload: unknown): CtaComponentData | null => {
  if (!payload || typeof payload !== "object") return null;
  const messages = (payload as HumanWritingA2uiPayload).messages;
  if (!Array.isArray(messages)) return null;
  const componentMap = new Map<string, Record<string, unknown>>();
  for (const message of messages) {
    const components = message?.surfaceUpdate?.components;
    if (!Array.isArray(components)) continue;
    for (const entry of components) {
      if (!entry || typeof entry !== "object") continue;
      const id = (entry as { id?: string }).id;
      const component = (entry as { component?: Record<string, unknown> }).component;
      if (!id || !component || typeof component !== "object") continue;
      componentMap.set(id, component);
    }
  }
  const title = componentMap.get("hw-cta-title")?.Text as Record<string, unknown> | undefined;
  const subtitle = componentMap.get("hw-cta-subtitle")?.Text as Record<string, unknown> | undefined;
  if (title || subtitle) {
    return {
      content: title ? pickLiteralString(title.text) : undefined,
      progressLabel: subtitle ? pickLiteralString(subtitle.text) : undefined,
    };
  }
  return null;
};
