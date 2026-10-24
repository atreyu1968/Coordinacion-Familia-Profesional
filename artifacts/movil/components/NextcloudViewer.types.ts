export type NextcloudViewerProps = {
  url: string;
  nextcloudUrl: string;
  title: string;
  onError: (message: string) => void;
  requestFreshUrl: () => Promise<string>;
};
