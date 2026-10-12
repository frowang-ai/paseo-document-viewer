import { t } from "./client/locale";
import type {
  PluginClientContext,
  PluginSidebarItemProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { DocumentPanel } from "./client/panel";
import { activeWorkspace, captureDocumentClicks } from "./client/web";
import { documents } from "./client/store";
import { documentPanelId } from "./shared/document-state";

export default function contribute(client: PluginClientContext) {
  const panels = new Map<string, { path: string; remove: () => void }>();
  function ensurePanel(path: string) {
    const id = documentPanelId(path),
      existing = panels.get(id);
    if (existing) {
      if (existing.path !== path) throw new Error("Document panel identity collision.");
      return id;
    }
    const remove = client.addWorkspacePanel({
      id,
      title: (path.split("/").pop() || path).slice(-120),
      icon: /\.pdf$/i.test(path) ? "FileText" : "FileCode",
      context: "workspace",
      locations: ["workspace", "explorer"],
      Component: (props: PluginWorkspacePanelProps) => (
        <DocumentPanel
          {...props}
          documentPath={path}
          onOpenDocument={(target, page) =>
            openDocument(props.host.id, props.workspaceId, target, page)
          }
        />
      ),
    });
    panels.set(id, { path, remove });
    return id;
  }
  function openDocument(hostId: string, workspaceId: string, path: string, page?: number) {
    documents.open(hostId, workspaceId, path, page);
    client.openPanel(ensurePanel(path), { workspaceId, location: "workspace" });
  }
  for (const session of documents.all()) ensurePanel(session.path);
  function DocumentsItem({ host, openPopover }: PluginSidebarItemProps) {
    useEffect(
      () =>
        captureDocumentClicks(host.id, (workspaceId, path) => {
          openDocument(host.id, workspaceId, path);
        }),
      [host.id],
    );
    return (
      <SidebarRow
        icon="Files"
        onPress={() => {
          void activeWorkspace(host.id)
            .then((workspaceId) => client.openPanel("documents", { workspaceId }))
            .catch((error) =>
              openPopover(({ theme }) => (
                <View style={{ padding: 16 }}>
                  <Text style={{ color: theme.colors.foreground }}>
                    {t(error instanceof Error ? error.message : "워크스페이스를 먼저 선택하세요.")}
                  </Text>
                </View>
              )),
            );
        }}
      />
    );
  }
  client.addWorkspacePanel({
    id: "documents",
    title: t("문서"),
    icon: "Files",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: (props: PluginWorkspacePanelProps) => (
      <DocumentPanel
        {...props}
        onOpenDocument={(path, page) => openDocument(props.host.id, props.workspaceId, path, page)}
      />
    ),
  });
  client.addCommandCenterItem({
    id: "open-documents",
    title: t("문서 열기 (HTML · PDF)"),
    icon: "Files",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("documents");
    },
  });
  client.addSidebarFooterItem({ id: "documents", title: t("문서"), Component: DocumentsItem });
  return () => {
    for (const panel of panels.values()) panel.remove();
    panels.clear();
  };
}
