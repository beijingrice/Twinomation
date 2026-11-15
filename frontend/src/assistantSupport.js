import {scenarioCopy} from './delayScenarios.js';
import {connectionRows} from './passengerGuidance.js';

// Match a chosen concern to the flight information already visible to this passenger.
// No inferred emotion, new operational facts or changes to the passenger's booking.
export function supportQuestions(cause, status, connection, now, language) {
  const zh=language==='zh';
  const copy=scenarioCopy(cause,language);
  const comfort=zh
    ? ['等得有些着急','行程被耽误，还要一直等消息，确实很耗神。我先帮您把下一步看清楚：'+copy.next+' 如果您有紧急行程或特别需要，可以先向地面工作人员说明，让他们了解您的情况。']
    : ['The wait is making me anxious','A disrupted trip and an uncertain wait can be exhausting. Let’s make the next step clearer: '+copy.next+' If you have an urgent commitment or a particular need, please let ground staff know so they understand your situation.'];
  if (!connection) return [comfort,zh
    ? ['接下来会怎么安排？','我知道，清楚接下来的安排，会让等候更有着落。'+copy.next+' '+copy.action]
    : ['What happens next?','Knowing the next step can make the wait a little easier to plan. '+copy.next+' '+copy.action]];

  const {arrival,rows}=connectionRows(connection,status,now);
  const booked=rows.find(r=>r.booked);
  let answer;
  if (!arrival || !booked) answer=zh
    ? '担心影响下一段行程，确实让人挂心。目前还缺少可确认的抵达时间或原订航班信息，我不想给您一个猜测。您可以先向地面工作人员说明中转安排，请他们核实后续衔接；这里的列表也可以作为沟通时的参考。'
    : 'Worrying about the next part of your trip can add to the stress. A confirmed arrival time or booked connection is still missing here, and I do not want to guess. Ground staff can check your onward arrangements; this list can help you explain your concern.';
  else if (booked.state==='cancelled' || booked.state==='departed') answer=zh
    ? `我知道这会让后面的安排更难。当前列表将原订航班 ${booked.flight_no} 标记为${booked.state==='cancelled'?'已取消':'已起飞'}，建议尽早请航空公司核实后续安排。您也可以一起查看列表中的其他班次；这里不会替您作出预订或改签。`
    : `I know this makes the rest of the journey harder to plan. The list marks your booked flight ${booked.flight_no} as ${booked.state==='cancelled'?'cancelled':'departed'}. Please ask the airline to check your onward arrangements. Other listed flights can help that conversation; nothing is booked or changed here.`;
  else if (booked.unavailable) answer=zh
    ? `担心赶不上转机，确实会更着急。按当前预计时间，原订航班 ${booked.flight_no} 的衔接余量偏紧，可能赶不上。建议先请航空公司核实后续安排，也可以把列表中的其他班次作为沟通参考；目前并没有替您改签。`
    : `It is understandable to feel more anxious about a connection. With the current estimate, time for your booked flight ${booked.flight_no} looks tight and it may be missed. Please ask the airline to check onward arrangements. Other listed flights can help that conversation; no rebooking has been made.`;
  else answer=zh
    ? `我理解您惦记着下一段行程。按当前预计时间，原订航班 ${booked.flight_no} 暂有衔接余量，但航班变化和转机手续仍可能影响安排。您可以继续留意更新，并请地面工作人员核实中转要求；这里不会替您更改预订。`
    : `I understand the next part of your trip is on your mind. Your booked flight ${booked.flight_no} currently has some connection time, though flight changes and transfer procedures can still affect it. Keep watching updates and ask ground staff to check the transfer requirements; your booking is not changed here.`;
  return [comfort,[zh?'担心赶不上转机':'I’m worried about my connection',answer]];
}
