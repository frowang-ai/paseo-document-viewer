import { uiLanguage } from "./web";
const english: Record<string, string> = {
  문서: "Documents",
  "문서 열기 (HTML · PDF)": "Open documents (HTML · PDF)",
  "파일 닫기": "Hide files",
  "파일 선택": "Choose file",
  새로고침: "Reload",
  "상위 폴더": "Parent folder",
  "HTML 축소": "Zoom HTML out",
  "HTML 확대": "Zoom HTML in",
  "HTML 배율 초기화": "Reset HTML zoom",
  "문서를 준비하고 있습니다…": "Preparing document…",
  "파일 목록에서 HTML 또는 PDF를 선택하세요.": "Choose an HTML or PDF file from the file list.",
  "문서 미리보기는 데스크톱·웹에서 지원합니다.":
    "Document previews are available on desktop and web.",
  "문서 뷰어는 데스크톱·웹에서 열 수 있습니다.": "Open the document viewer on desktop or web.",
  "워크스페이스를 먼저 선택하세요.": "Select a workspace first.",
  "현재 호스트의 워크스페이스를 먼저 선택하세요.": "Select a workspace on this host first.",
  "문서를 열지 못했습니다.": "Could not open the document.",
  "외부 리소스는 불러오지 않았습니다.": "External resources were not loaded.",
  "누락되었거나 문서 폴더 밖에 있는 리소스가 있습니다.":
    "Some resources are missing or outside the document folder.",
  "이 폴더 밖의 파일은 열 수 없습니다.": "Files outside this folder cannot be opened.",
  "일반 파일만 열 수 있습니다.": "Only regular files can be opened.",
  "워크스페이스 폴더를 찾을 수 없습니다.": "Workspace folder not found.",
  "HTML 또는 PDF 파일을 선택하세요.": "Select an HTML or PDF file.",
  "유효한 PDF 파일이 아닙니다.": "This is not a valid PDF file.",
};
export const t = (text: string) => (uiLanguage() === "ko" ? text : (english[text] ?? text));
