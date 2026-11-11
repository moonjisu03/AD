/* 설문 문항 정의. 원본 `광고 해석 설문지.html`의 문항 은행과 흐름(buildFlow)을 그대로 옮긴 것.
 * 문구·보기·선별 조건을 바꾸면 SURVEY_VERSION을 올리고 README의 변경 기록에 적는다.
 * buildFlow의 두 번째 인자 S는 진행 상태 객체(원본의 전역 S와 같은 역할)이다. */
export const SURVEY_VERSION='2026-11-v1';

/* ---------- 문항 은행 ---------- */
var DK=[99,'잘 모르겠다','fix'];
var BANNERS=[
 {n:1,img:'b01',a1:[[1,'버튼'],[2,'혜택 금액·숫자'],[3,'설명 문구'],[4,'작은 글씨'],[5,'서비스 이름'],[6,'잘 모르겠다','fix excl']],b4:[
  {q:'‘보험 환급금 조회 시작하기’ 버튼을 누르면 어떻게 될 것 같나요?',o:[[1,'내 보험금을 바로 조회해 준다'],[2,'조회하려면 먼저 가입해야 한다'],[3,'환급금을 바로 받는다'],[4,'잘 모르겠다','fix']]},
  {q:'‘매월 3,000원 쿠폰 증정’은 어떤 뜻이라고 생각하세요?',o:[[1,'한 번만 받는다'],[2,'매달 받는다'],[3,'서비스에 가입해야 받는다'],[4,'그 밖의 조건을 채워야 받는다'],[5,'잘 모르겠다','fix']]}]},
 {n:2,img:'b04',a1:[[1,'버튼'],[2,'그림·아이콘'],[3,'설명 문구'],[4,'작은 글씨'],[5,'서비스 이름'],[6,'잘 모르겠다','fix excl']],b4:[
  {q:'빨간 ‘!’ 그림과 체크 표시는 무슨 뜻이라고 생각하세요?',o:[[1,'지금 위험하다는 경고다'],[2,'이미 보호되고 있다는 표시다'],[3,'가입하면 보호된다는 뜻이다'],[4,'꾸미기일 뿐이다'],[5,'잘 모르겠다','fix']]},
  {q:'‘서비스 이용을 위해 가입이 필요합니다’라는 글은 어떤 뜻으로 보이나요?',o:[[1,'안 하면 지금 설명하는 서비스를 못 쓸 수도 있어서 꼭 해야 한다'],[2,'이 광고 속 서비스를 쓰고 싶을 때만 하면 된다'],[3,'잘 모르겠다','fix']]}]},
 {n:3,img:'b15',a1:[[1,'버튼'],[2,'혜택 금액·숫자'],[3,'설명 문구'],[4,'그림·아이콘'],[5,'작은 글씨'],[6,'서비스 이름'],[7,'잘 모르겠다','fix excl']],b4:[
  {q:'화살표 모양을 어떻게 생각하셨나요?',o:[[1,'눌러야 하는 버튼이라고 생각했다'],[2,'방향을 알려 주는 그림이라고 생각했다'],[3,'꾸미기라고 생각했다'],[4,'잘 모르겠다','fix']]},
  {q:'‘확인하기’를 누르면 무엇을 확인하게 될 것 같나요?',o:[[1,'서비스 내용'],[2,'내 보험·상태'],[3,'가입 화면'],[4,'혜택을 받을 자격'],[5,'잘 모르겠다','fix']]}]}
];
var CONF_LABEL='방금 고른 답이 얼마나 확실하세요?';

function q(o){ o.type='q'; return o; }
function withOther(o){
  var a=o.slice(0,-1); /* 마지막은 늘 ‘잘 모르겠다’ */
  a.push([a.length+1,'그 외(직접 쓰기)','other fix']);
  a.push([a.length+1,'잘 모르겠다','fix']);
  return a;
}
export function buildFlow(order,S){
  var f=[];
  f.push({type:'consent',id:'consent',phase:'start',sec:'시작'});
  f.push(q({id:'Q1',phase:'screen',sec:'기본 질문',kind:'single',text:'나이대가 어떻게 되시나요?',
    opts:[[1,'20대'],[2,'30대'],[3,'40대'],[4,'50대'],[5,'60대'],[6,'70대 이상']],
    end:function(v){ return (v===3||v===6)?'age':''; },
    after:function(v){ S.group=(v===4||v===5)?'50-60':((v===1||v===2)?'20-30':''); }}));
  f.push(q({id:'Q2',phase:'screen',sec:'기본 질문',kind:'single',text:'스마트폰은 얼마나 자주 쓰시나요?',
    opts:[[1,'하루에 여러 번'],[2,'하루에 한 번 정도'],[3,'일주일에 몇 번'],[4,'거의 안 쓴다']],
    end:function(v){ return v===4?'phone':''; }}));
  f.push(q({id:'Q3',phase:'screen',sec:'기본 질문',kind:'single',stage:'b03',
    text:'이런 광고에서 버튼을 눌러 서비스에 가입해 본 적이 최근 1년 안에 있으신가요?',
    hint:'위 사진은 예시입니다. 시간 제한 없이 보셔도 됩니다.',
    opts:[[1,'가입해 본 적이 있다'],[2,'눌러는 봤지만 가입하지는 않았다'],[3,'눌러 본 적이 없다'],[4,'기억이 안 난다','fix']],
    end:function(v){ return (v===4&&S.group==='50-60')?'no-experience':''; },
    after:function(v){ S.cond=(v===2); }}));
  f.push(q({id:'Q3_1',phase:'screen',sec:'기본 질문',kind:'single',text:'기억나는 것 하나만 골라 주세요. 어떤 종류의 서비스였나요?',
    opts:[[1,'쇼핑·결제'],[2,'보험·금융'],[3,'영상·음악·콘텐츠'],[4,'보안·안심 서비스'],[5,'기타(직접 쓰기)','other'],[6,'기억이 안 난다','fix']],
    skip:function(){ var v=S.ans.Q3; return !(v===1||v===2); }}));
  f.push(q({id:'Q3_2',phase:'screen',sec:'기본 질문',kind:'multi',text:'그 배너는 어디서 보셨나요? (여러 개 가능)',
    opts:[[1,'문자 메시지'],[2,'앱 안의 배너'],[3,'인터넷·영상 중 광고'],[4,'카톡 등 메신저'],[5,'기타(직접 쓰기)','other'],[6,'기억이 안 난다','fix excl']],
    skip:function(){ var v=S.ans.Q3; return !(v===1||v===2); }}));
  f.push(q({id:'Q3_3',phase:'screen',sec:'기본 질문',kind:'multi',shuffle:true,text:'이런 광고를 눌러 보지 않은 가장 큰 이유는 무엇인가요? (여러 개 가능)',
    opts:[[1,'광고라서 믿기 어렵다'],[2,'눌러도 되는 것인지 잘 모르겠다'],[3,'무슨 내용인지 알기 어렵다'],[4,'누르면 가입되거나 돈이 나갈 것 같다'],[5,'나에게 필요하지 않다'],[6,'그 외(직접 쓰기)','other fix'],[7,'기억이 안 난다','fix excl']],
    skip:function(){ return S.ans.Q3!==3; },
    end:function(){ return S.group==='50-60'?'no-experience':''; }}));
  f.push(q({id:'Q4',phase:'screen',sec:'기본 질문',kind:'single',text:'가입한 서비스를 중간에 해지한 적이 있나요?',
    opts:[[1,'해지한 적이 있다'],[2,'해지하려 했지만 방법을 못 찾았다'],[3,'해지한 적은 없다'],[4,'가입한 서비스가 없다'],[5,'기억이 안 난다','fix']]}));

  order.forEach(function(bn,pos){
    var B=BANNERS[bn-1], p='s'+bn+'_', sec='광고 사진 '+(pos+1)+'/'+BANNERS.length;
    f.push({type:'info',id:p+'info',phase:'intro',sec:sec,banner:bn,pos:pos+1});
    f.push({type:'exposure',id:p+'exp',phase:'exp',sec:sec,banner:bn});
    f.push(q({id:p+'A1',phase:'A',sec:sec,kind:'multi',max:2,shuffle:true,chip:'사진은 가렸어요. 기억나는 대로 골라 주세요.',
      text:'방금 사진에서 가장 먼저 눈에 들어온 것은 무엇인가요?',hint:'최대 2개까지 고를 수 있어요.',
      opts:B.a1}));
    f.push(q({id:p+'A2',phase:'A',sec:sec,kind:'single',shuffle:true,chip:'사진은 가렸어요. 기억나는 대로 골라 주세요.',
      text:'무슨 서비스라고 생각하셨나요?',hint:'가장 가까운 것 하나를 고르세요.',
      opts:[[1,'무료 서비스'],[2,'유료 서비스'],[3,'쿠폰·포인트를 주는 이벤트'],[4,'보안·안전 관련 안내'],[5,'보험 관련 서비스'],[6,'서비스 내용을 모르겠다','fix'],[7,'기타(직접 쓰기)','other fix']]}));
    f.push(q({id:p+'A3',phase:'A',sec:sec,kind:'single',shuffle:true,chip:'사진은 가렸어요. 기억나는 대로 골라 주세요.',
      text:'그 사진 속 버튼을 누르면 어떤 일이 일어날 것 같나요?',
      opts:[[1,'바로 가입된다'],[2,'혜택을 바로 받는다'],[3,'다음 화면에서 내용을 더 보고 정한다'],[4,'돈이 빠져나갈 수도 있다'],[5,'다른 앱이나 페이지로 넘어간다'],[6,'잘 모르겠다','fix']]}));
    f.push(q({id:p+'A4',phase:'A',sec:sec,kind:'single',shuffle:true,chip:'사진은 가렸어요. 기억나는 대로 골라 주세요.',
      text:'방금 사진은 광고라고 생각하셨나요, 아니면 안내라고 생각하셨나요?',
      opts:[[1,'광고다'],[2,'안내·공지다'],[3,'잘 모르겠다','fix']]}));
    var st='b'+(B.img.slice(1)), chipB='사진을 다시 보여 드려요. 보면서 골라 주세요.';
    f.push(q({id:p+'B1',phase:'B',sec:sec,kind:'single',stage:B.img,chip:chipB,text:'돈이 드는 서비스라고 생각하세요?',
      opts:[[1,'무료다'],[2,'처음에는 무료이고 나중에 돈이 든다'],[3,'처음부터 돈이 든다'],[4,'잘 모르겠다','fix']]}));
    f.push(q({id:p+'B2',phase:'B',sec:sec,kind:'single',stage:B.img,chip:chipB,text:'이 사진 속 버튼을 누르면 바로 가입될 것 같나요?',
      opts:[[1,'바로 가입될 것 같다'],[2,'한 번 더 확인하는 화면이 나올 것 같다'],[3,'가입 절차(동의·정보 입력)를 마쳐야 내용이 보일 것 같다'],[4,'가입은 안 되고 내용만 보여 줄 것 같다'],[5,'잘 모르겠다','fix']]}));
    B.b4.forEach(function(x,ix){
      f.push(q({id:p+'B3_'+(ix+1),conf:p+'B4_'+(ix+1),phase:'B',sec:sec,kind:'single',stage:B.img,chip:chipB,shuffle:true,text:x.q,opts:withOther(x.o)}));
    });
    f.push(q({id:p+'B5',phase:'B',sec:sec,kind:'single',stage:B.img,chip:chipB,text:'‘유료서비스 광고’라고 적힌 작은 글씨를 읽으셨나요?',
      hint:'사진 안에 작게 적혀 있습니다.',
      opts:[[1,'읽었다'],[2,'있는 줄은 알았지만 읽지 않았다'],[3,'있는 줄 몰랐다']]}));
  });

  f.push(q({id:'M1',phase:'close',sec:'마무리',kind:'single',text:'지금까지 본 사진 중에 가장 이해하기 어려웠던 것은 무엇이었나요?',cards:true,
    opts:order.map(function(bn,pos){ return [bn,'사진 '+(pos+1),BANNERS[bn-1].img]; }).concat([[4,'모두 이해하기 쉬웠다','fix']])}));
  f.push(q({id:'M2',phase:'close',sec:'마무리',kind:'multi',text:'그 사진이 어려웠던 이유는 무엇이라고 생각하세요? (여러 개 가능)',
    opts:[[1,'버튼 말이 어렵다'],[2,'숫자가 무슨 뜻인지 모르겠다'],[3,'그림이 무슨 뜻인지 모르겠다'],[4,'글자가 너무 작다'],[5,'서비스 설명이 없다'],[6,'한눈에 들어오지 않는다'],[7,'기타(직접 쓰기)','other fix']],
    skip:function(){ return S.ans.M1===4; }}));
  f.push(q({id:'M3',phase:'close',sec:'마무리',kind:'multi',text:'이런 광고의 서비스에 가입하려면 무엇이 필요할 것 같나요? (여러 개 가능)',
    opts:[[1,'아무것도 필요 없다','excl'],[2,'개인정보 입력'],[3,'결제수단 등록'],[4,'앱 설치'],[5,'본인 인증'],[6,'다른 서비스 가입'],[7,'잘 모르겠다','fix excl']]}));
  f.push(q({id:'M4',phase:'close',sec:'마무리',kind:'single',text:'이런 광고를 보고 서비스에 가입했다고 상상해 보세요. 나중에 해지하고 싶을 때, 그 방법을 광고에서 알 수 있을 것 같나요?',
    opts:[[1,'해지 방법이 분명히 나와 있을 것 같다'],[2,'어느 정도는 알 수 있을 것 같다'],[3,'알아내기 어려울 것 같다'],[4,'전혀 알 수 없을 것 같다'],[5,'잘 모르겠다','fix']]}));
  f.push(q({id:'M5',phase:'close',sec:'마무리',kind:'multi',text:'폰에서 이런 배너를 누르기 전에 보통 무엇을 확인하시나요? (여러 개 가능)',
    opts:[[1,'아무것도 확인하지 않는다','excl'],[2,'작은 글씨를 읽는다'],[3,'아래 설명을 스크롤해 본다'],[4,'가족이나 지인에게 묻는다'],[5,'인터넷에 검색해 본다'],[6,'기타(직접 쓰기)','other fix']]}));
  f.push(q({id:'M6',phase:'close',sec:'마무리',kind:'text',optional:true,text:'마지막으로 하고 싶은 말씀이 있으면 편하게 적어 주세요.',hint:'없으면 그냥 ‘제출하기’를 눌러 주세요.'}));
  return f;
}

export {DK,BANNERS,CONF_LABEL,withOther};
