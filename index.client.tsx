import { t } from "./client/locale";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { DocumentPanel } from "./client/panel";
import { activeWorkspace, captureDocumentClicks } from "./client/web";
import { selectDocument, selectionKey } from "./client/store";

export default function contribute(client: PluginClientContext) {
  function DocumentsItem({ host, openPopover }: PluginSidebarItemProps) {
    useEffect(
      () =>
        captureDocumentClicks(host.id, (workspaceId, path) => {
          selectDocument(selectionKey(host.id, workspaceId), path);
          client.openPanel("documents", { workspaceId });
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
    Component: DocumentPanel,
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
  return () => {};
}
