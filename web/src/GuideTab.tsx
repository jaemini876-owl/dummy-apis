import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { api, type Project } from './api';
import { copy, useAsync, useToast } from './ui';

function Snippet({ title, code }: { title: string; code: string }) {
  const toast = useToast();
  return (
    <div className="snippet">
      <div className="row between"><strong>{title}</strong><button className="ghost small" onClick={() => copy(code, toast)}>복사</button></div>
      <pre>{code}</pre>
    </div>
  );
}

function Qr({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, text, { width: 160, margin: 1 }).catch(() => {});
  }, [text]);
  return <canvas ref={ref} aria-label="QR" />;
}

export function GuideTab({ project }: { project: Project }) {
  const { data: info } = useAsync(api.serverInfo, []);
  const toast = useToast();
  const origin = info?.publicBaseUrl ?? location.origin;
  const candidates = [
    origin,
    ...(info?.publicBaseUrl ? [] : (info?.lanIps ?? []).map((ip) => `http://${ip}:${info!.port}`)),
  ];
  const [base, setBase] = useState<string | null>(null);
  const root = `${base ?? candidates[0]}/m/${project.slug}`;
  const isLocalhost = /localhost|127\.0\.0\.1/.test(root);

  return (
    <section>
      <h3>베이스 URL</h3>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="row">
            <select value={base ?? candidates[0]} onChange={(e) => setBase(e.target.value)}>
              {candidates.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="ghost" onClick={() => copy(root, toast)}>복사</button>
          </div>
          <p><code className="big">{root}</code></p>
          <p className="muted">
            앱의 API 베이스 URL을 위 주소로 바꾸면, 실제 백엔드와 같은 path(<code>/v2/orders/1</code> 등)를 그대로 호출할 수 있습니다.
            {isLocalhost && ' 실기기에서는 localhost 대신 PC의 LAN IP(위 목록)를 사용하세요.'}
          </p>
        </div>
        <Qr text={root} />
      </div>

      <h3>에뮬레이터 / 시뮬레이터 주소</h3>
      <ul>
        <li>iOS 시뮬레이터: <code>http://localhost:{info?.port ?? 3000}</code></li>
        <li>Android 에뮬레이터: <code>http://10.0.2.2:{info?.port ?? 3000}</code> (호스트 PC의 localhost)</li>
        <li>실기기: 같은 Wi-Fi의 PC LAN IP, 방화벽에서 포트 허용 필요 (공유 서버라면 서버 주소)</li>
      </ul>

      <h3>HTTP(비 HTTPS) 허용 설정</h3>
      <Snippet title="iOS — Info.plist (개발용)" code={`<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key><true/>
  <!-- 외부 서버 HTTP 호출 시: -->
  <key>NSExceptionDomains</key>
  <dict><key>YOUR_HOST</key><dict>
    <key>NSExceptionAllowsInsecureHTTPLoads</key><true/>
  </dict></dict>
</dict>`} />
      <Snippet title="Android — res/xml/network_security_config.xml" code={`<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">10.0.2.2</domain>
    <domain includeSubdomains="true">YOUR_HOST_OR_LAN_IP</domain>
  </domain-config>
</network-security-config>
<!-- AndroidManifest.xml: android:networkSecurityConfig="@xml/network_security_config" -->`} />

      <h3>호출 예시</h3>
      <Snippet title="curl" code={`curl -i ${root}/your/path\ncurl -i ${root}/_/status/503      # 상태 코드 즉시 확인\ncurl -i ${root}/_/delay/3000      # 3초 지연`} />
      <Snippet title="Swift (URLSession)" code={`let base = URL(string: "${root}")!
let (data, res) = try await URLSession.shared.data(from: base.appendingPathComponent("v2/orders/1"))
print((res as! HTTPURLResponse).statusCode, String(data: data, encoding: .utf8)!)`} />
      <Snippet title="Kotlin (Retrofit)" code={`val retrofit = Retrofit.Builder()
    .baseUrl("${root}/")   // 끝에 / 필요
    .addConverterFactory(GsonConverterFactory.create())
    .build()`} />

      <h3>템플릿 변수</h3>
      <p className="muted">
        응답 body/header에서 <code>{'{{params.id}}'}</code> <code>{'{{query.page}}'}</code> <code>{'{{body.user.email}}'}</code> <code>{'{{headers.authorization}}'}</code>{' '}
        <code>{'{{now}}'}</code> <code>{'{{timestamp}}'}</code> <code>{'{{uuid}}'}</code> <code>{'{{random.int(1,100)}}'}</code> <code>{'{{faker.name}}'}</code>{' '}
        (<code>email, phone, city, word, sentence, avatar, url, uuid</code>) 사용 가능
      </p>
      <p className="muted">저장소: {info?.storage === 'supabase' ? 'Supabase' : '로컬 파일 (팀 공유 시 Supabase 설정 권장)'} · v{info?.version}</p>
    </section>
  );
}
