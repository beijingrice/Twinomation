import {scenarioCopy} from './delayScenarios.js';

export const NOTICE_TEMPLATES = [
  ['flight_update','Latest flight arrangements'], ['waiting','Waiting reminder'],
  ['connection','Connection assistance'], ['care','Meals and assistance'], ['custom','Custom notice']
];

/** Only already-public operational fields enter templates; internal events are never copied. */
export function passengerNoticeTemplate(template, record) {
  const flight=record.flight_no;
  const gateZh=record.public_gate ? `登机口：${record.public_gate}。` : '';
  const gateEn=record.public_gate ? ` Gate: ${record.public_gate}.` : '';
  const time=record.public_departure ? new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Hong_Kong',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(record.public_departure)) : null;
  if(template==='flight_update') {
    if(record.flight_status==='DELAYED') return {
      text_zh:`很抱歉，航班 ${flight} ${record.delay_cause ? `因${scenarioCopy(record.delay_cause,'zh')?.title || '运行安排'}延误` : '已延误'}。${time ? `目前预计于香港时间 ${time} 起飞。` : '新的起飞时间仍待确认。'}${gateZh}感谢您的等候，请留意本页和机场广播的最新通知。`,
      text_en:`We’re sorry that flight ${flight} is delayed${record.delay_cause ? ` due to ${scenarioCopy(record.delay_cause,'en')?.title.toLowerCase() || 'operational arrangements'}` : ''}. ${time ? `Estimated departure is ${time} HKT.` : 'The new departure time is awaiting confirmation.'}${gateEn} Thank you for waiting. Please watch this page and airport announcements for updates.`
    };
    if(record.flight_status==='ON_TIME') return {text_zh:`航班 ${flight} 预计按计划运行。${time?`预计起飞：香港时间 ${time}。`:''}${gateZh}请留意机场广播及本页更新。`,text_en:`Flight ${flight} is expected on time.${time?` Estimated departure: ${time} HKT.`:''}${gateEn} Please watch airport announcements and this page.`};
    if(record.flight_status==='BOARDING') return {
      text_zh:`感谢您的等候。航班 ${flight} 已准备登机。${time ? `起飞时间为香港时间 ${time}。` : ''}${gateZh}请按照机场广播及地面工作人员的指引登机。`,
      text_en:`Thank you for waiting. Flight ${flight} is ready to board.${time ? ` Departure is at ${time} HKT.` : ''}${gateEn} Please follow airport announcements and ground staff’s boarding instructions.`
    };
    if(record.flight_status==='CANCELLED') return {
      text_zh:`很抱歉，航班 ${flight} 已取消，给您的行程带来了不便。请联系航空公司柜台或官方客服，核实后续安排。如有紧急行程或特别需要，也请一并向工作人员说明。`,
      text_en:`We’re sorry that flight ${flight} has been cancelled and your plans have been disrupted. Please contact the airline desk or official support to check the next arrangements. Let staff know about any urgent commitment or particular need.`
    };
    return {text_zh:`感谢您对航班 ${flight} 的关注。最新安排确认后会在本页更新，请留意机场广播。如有需要，可以向地面工作人员查询。`,text_en:`Thank you for checking on flight ${flight}. Confirmed arrangements will appear on this page. Please watch airport announcements, and ask ground staff if you need assistance.`};
  }
  const copy={
    waiting:{text_zh:`航班 ${flight} 的旅客，感谢您的等候。请留意最新航班通知和机场广播，并预留足够时间返回登机口。如有需要，欢迎向地面工作人员查询。`,text_en:`For passengers on flight ${flight}, thank you for waiting. Please watch the latest flight notices and airport announcements, and allow time to return to your gate. Ground staff can help with any questions.`},
    connection:{text_zh:`航班 ${flight} 的旅客，如果您还有后续中转行程，担心衔接受到影响，可以提前向地面工作人员说明，请他们核实后续安排。具体航班及退改选项以航空公司确认为准。`,text_en:`If you are travelling on flight ${flight} with an onward connection and are concerned about making it, please let ground staff know so they can check the next arrangements. Flight and change options need confirmation from the airline.`},
    care:{text_zh:`航班 ${flight} 的旅客，长时间等候可能让您感到疲惫。如有餐饮、行动协助或其他需要，可以向地面工作人员说明。具体协助安排以现场确认为准。`,text_en:`Waiting can be tiring for passengers on flight ${flight}. If you need help with meals, mobility or another concern, please let ground staff know. Specific assistance arrangements need confirmation on site.`},
    custom:{text_zh:'',text_en:''}
  };
  return copy[template] || copy.custom;
}

export function publishedNoticeForEvent(record,event) {
  return record.updates.find(u=>u.status==='PUBLISHED' && (u.source_event_id===event.id || event.type==='PASSENGER_NOTICE_PUBLISHED' && u.id===event.payload.update_id));
}
