import type { A2UIMessage } from "@/lib/a2ui/human-writing";

export const createSampleA2uiMessages = (params: {
  surfaceId: string;
  catalogId: string;
  title: string;
  subtitle: string;
}): A2UIMessage[] => {
  const { surfaceId, catalogId, title, subtitle } = params;

  return [
    {
      surfaceUpdate: {
        surfaceId,
        components: [
          {
            id: "root",
            component: {
              Column: {
                children: { explicitList: ["title", "subtitle"] },
              },
            },
          },
          {
            id: "title",
            component: {
              Text: {
                text: { literalString: title },
                usageHint: "h2",
              },
            },
          },
          {
            id: "subtitle",
            component: {
              Text: {
                text: { literalString: subtitle },
              },
            },
          },
        ],
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
        root: "root",
      },
    },
  ];
};
