import { t } from "./locale";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  listDocuments,
  prepareDocument,
  readDocumentChunk,
  readPdfAsset,
} from "../shared/documents";
import { documents } from "./store";
import { documentKey } from "../shared/document-state";
import { decodeChunks, mountDocument, updateHtmlZoom } from "./web";
import { nextHtmlZoom } from "../shared/zoom";
import { documentLink } from "../shared/documents";

type DocumentPanelProps = PluginWorkspacePanelProps & {
  documentPath?: string;
  onOpenDocument(path: string, page?: number): void;
};
export function DocumentPanel({
  host,
  workspaceId,
  theme,
  layout,
  documentPath,
  onOpenDocument,
}: DocumentPanelProps) {
  const key = documentPath ? documentKey(host.id, workspaceId, documentPath) : "";
  const selection = useSyncExternalStore(
    documents.subscribe,
    () => documents.get(key),
    () => null,
  );
  useEffect(() => {
    if (documentPath) documents.open(host.id, workspaceId, documentPath);
  }, [host.id, workspaceId, documentPath]);
  const openRef = useRef(onOpenDocument);
  openRef.current = onOpenDocument;
  const root = useWorkspace(workspaceId, (w) => w.directory);
  const [folder, setFolder] = useState(".");
  const [files, setFiles] = useState(!documentPath);
  const htmlZoom = selection?.view.htmlZoom ?? 1;
  const reloadRevision = selection?.revision;
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    html?: string;
    name?: string;
    kind?: string;
    warnings?: string[];
  }>({ loading: false });
  const frame = useRef<View>(null);
  const list = useRpc(listDocuments),
    prepare = useRpc(prepareDocument),
    chunk = useRpc(readDocumentChunk),
    asset = useRpc(readPdfAsset);
  // SDK callbacks can be refreshed with host context; reading-position updates
  // must not remount the frame or start another download.
  const rpcRef = useRef({ prepare, chunk, asset });
  rpcRef.current = { prepare, chunk, asset };
  const directory = useQuery({
    queryKey: ["documents-list", host.id, workspaceId, folder],
    queryFn: () => list({ workspaceId, path: folder }),
    enabled: Boolean(root) && files,
    retry: false,
  });
  useEffect(() => {
    const selection = documents.get(key);
    if (!selection || selection.revision !== reloadRevision) return;
    setFiles(false);
    if (layout.platform !== "web") {
      setState({ loading: false, error: "문서 미리보기는 데스크톱·웹에서 지원합니다." });
      return;
    }
    let alive = true;
    setState({ loading: true });
    void (async () => {
      const prepared = await rpcRef.current.prepare({
        workspaceId,
        path: selection.path,
        page: selection.view.page,
      });
      const chunks: string[] = [];
      let offset = 0;
      while (offset < prepared.bytes) {
        if (!alive) return;
        const part = await rpcRef.current.chunk({ workspaceId, id: prepared.id, offset });
        chunks.push(part.base64);
        offset = part.next;
      }
      if (alive)
        setState({
          loading: false,
          html: decodeChunks(chunks),
          name: prepared.name,
          kind: prepared.kind,
          warnings: prepared.warnings,
        });
    })().catch((error) => {
      if (alive)
        setState({
          loading: false,
          error: error instanceof Error ? error.message : "문서를 열지 못했습니다.",
        });
    });
    return () => {
      alive = false;
    };
  }, [key, reloadRevision, workspaceId, layout.platform]);
  useEffect(
    () =>
      state.html
        ? mountDocument(
            frame.current,
            state.html,
            state.name ?? "문서",
            state.kind ?? "html",
            (kind, name) => rpcRef.current.asset({ kind, name }),
            (href) => {
              const target = documentPath && documentLink(documentPath, href);
              if (target) openRef.current(target.path, target.page);
            },
            (scale) => documents.updateView(key, { htmlZoom: scale }),
            documents.get(key)?.view,
            (view) => documents.updateView(key, view),
          )
        : undefined,
    [state.html, state.name, state.kind, documentPath, key],
  );
  useEffect(() => {
    if (state.html) updateHtmlZoom(frame.current, htmlZoom);
  }, [htmlZoom, state.html]);
  const color = theme.colors;
  const button = (title: string, action: () => void, label = title) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(title)}
      onPress={action}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: 5,
      }}
    >
      <Text style={{ color: color.foreground, fontSize: 13 }}>{t(label)}</Text>
    </Pressable>
  );
  return (
    <View testID="document-viewer-panel" style={{ flex: 1, backgroundColor: color.surface0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: 10,
          borderBottomWidth: 1,
          borderColor: color.border,
        }}
      >
        {button(files ? "파일 닫기" : "파일 선택", () => setFiles(!files))}
        {state.kind === "html" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {button(
              "HTML 축소",
              () => documents.updateView(key, { htmlZoom: nextHtmlZoom(htmlZoom, -0.1) }),
              "−",
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("HTML 배율 초기화")}
              onPress={() => documents.updateView(key, { htmlZoom: 1 })}
              style={{ padding: 7 }}
            >
              <Text style={{ color: color.foreground, fontSize: 13 }}>
                {Math.round(htmlZoom * 100)}%
              </Text>
            </Pressable>
            {button(
              "HTML 확대",
              () => documents.updateView(key, { htmlZoom: nextHtmlZoom(htmlZoom, 0.1) }),
              "+",
            )}
          </View>
        ) : null}
        <Text numberOfLines={1} style={{ flex: 1, color: color.foreground, fontSize: 14 }}>
          {selection?.path ?? state.name ?? "HTML · PDF"}
        </Text>
        {selection ? button("새로고침", () => documents.reload(key)) : null}
      </View>
      <View style={{ flex: 1, flexDirection: layout.compact ? "column" : "row" }}>
        {files ? (
          <View
            style={{
              width: layout.compact ? "100%" : 240,
              maxHeight: layout.compact ? 230 : undefined,
              borderRightWidth: 1,
              borderColor: color.border,
            }}
          >
            <View style={{ padding: 10, gap: 8 }}>
              {button("상위 폴더", () =>
                setFolder(folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "."),
              )}
              <Text numberOfLines={2} style={{ color: color.foregroundMuted, fontSize: 12 }}>
                {directory.data?.path ?? folder}
              </Text>
            </View>
            <ScrollView>
              {directory.isPending ? <ActivityIndicator color={color.foregroundMuted} /> : null}
              {directory.error ? (
                <Text style={{ padding: 10, color: color.statusDanger }}>
                  {directory.error.message}
                </Text>
              ) : null}
              {directory.data?.entries.map((entry) => (
                <Pressable
                  key={entry.path}
                  accessibilityRole="button"
                  accessibilityLabel={entry.name}
                  onPress={() => {
                    if (entry.directory) setFolder(entry.path);
                    else {
                      openRef.current(entry.path);
                      if (documentPath) setFiles(false);
                    }
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderColor: color.border,
                  }}
                >
                  <Text style={{ color: color.foreground, fontSize: 13 }}>
                    {entry.directory ? "▸ " : ""}
                    {entry.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        <View style={{ flex: 1, minHeight: 200 }}>
          {state.loading ? (
            <View style={{ padding: 24, gap: 10 }}>
              <ActivityIndicator color={color.accent} />
              <Text style={{ color: color.foregroundMuted, textAlign: "center" }}>
                {t("문서를 준비하고 있습니다…")}
              </Text>
            </View>
          ) : null}
          {state.error ? (
            <Text accessibilityRole="alert" style={{ padding: 20, color: color.statusDanger }}>
              {t(state.error)}
            </Text>
          ) : null}
          {!selection ? (
            <Text style={{ padding: 24, color: color.foregroundMuted }}>
              {t("파일 목록에서 HTML 또는 PDF를 선택하세요.")}
            </Text>
          ) : null}
          {state.warnings?.length ? (
            <Text style={{ padding: 7, color: color.foregroundMuted, fontSize: 12 }}>
              {state.warnings.map(t).join(" ")}
            </Text>
          ) : null}
          <View
            ref={frame}
            style={{ flex: 1, display: state.html ? "flex" : "none" }}
            testID="document-frame-host"
          />
        </View>
      </View>
    </View>
  );
}
