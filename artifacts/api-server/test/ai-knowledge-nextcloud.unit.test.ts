import { describe, expect, it } from "vitest";
import { parseGroupFolderDav } from "../src/lib/aiKnowledgeNextcloud";

describe("Nextcloud knowledge WebDAV parsing", () => {
  it("keeps only readable files inside the requested group folder", () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
        <d:response>
          <d:href>/remote.php/dav/groupfolders/31/</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
        </d:response>
        <d:response>
          <d:href>/remote.php/dav/groupfolders/31/Gu%C3%ADa%20docente.pdf</d:href>
          <d:propstat><d:prop><d:resourcetype/><d:getetag>&quot;abc&quot;</d:getetag><d:getcontentlength>42</d:getcontentlength><oc:permissions>RGDNVCK</oc:permissions></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
        </d:response>
        <d:response>
          <d:href>/remote.php/dav/groupfolders/31/privado.txt</d:href>
          <d:propstat><d:prop><d:resourcetype/><d:getetag>&quot;def&quot;</d:getetag><oc:permissions>W</oc:permissions></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
        </d:response>
        <d:response>
          <d:href>/remote.php/dav/groupfolders/32/ajeno.txt</d:href>
          <d:propstat><d:prop><d:resourcetype/><oc:permissions>R</oc:permissions></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
        </d:response>
      </d:multistatus>`;

    expect(parseGroupFolderDav(xml, 31)).toEqual([{
      folderId: 31,
      mountPoint: "",
      path: ["Guía docente.pdf"],
      fileName: "Guía docente.pdf",
      etag: '"abc"',
      size: 42,
    }]);
  });

  it("rejects XML entity declarations and path traversal", () => {
    expect(() => parseGroupFolderDav("<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///etc/passwd'>]><x/>", 1)).toThrow();
    const traversal = `<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response>
      <d:href>/remote.php/dav/groupfolders/1/%2E%2E/secret.txt</d:href>
      <d:propstat><d:prop><d:resourcetype/><oc:permissions>R</oc:permissions></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    </d:response></d:multistatus>`;
    expect(parseGroupFolderDav(traversal, 1)).toEqual([]);
  });
});
