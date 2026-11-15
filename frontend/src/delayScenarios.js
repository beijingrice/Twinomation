// Fixed, bilingual passenger explanations; no live diagnosis or generated promises.
export const DELAY_SCENARIOS = {
  "WEATHER": {
    "minutes": 90,
    "zh": {
      "title": "天气影响",
      "summary": "机场或航路天气暂不满足正常起降条件，航班需要等待天气改善及相关运行安排。",
      "next": "运行团队会持续评估天气与起飞条件，确认新的安排后更新起飞时间。",
      "action": "请留意机场广播与本页更新，暂时不要仅凭预计起飞时间离开候机区域。",
      "qa": [
        [
          "为什么别的航班能飞？",
          "看到其他航班起飞，自己却还在等，难免会着急。不同航线、机型和时段的运行条件会有差别，本航班仍需要确认自身的起飞条件。您可以先留意本航班的广播和页面更新。"
        ],
        [
          "还会继续延误吗？",
          "没有确定的时间，确实不容易安排后面的行程。天气变化时，预计起飞时间可能还会调整，请以最新确认的通知为准。如果您有紧急安排，也可以先向地面工作人员说明。"
        ]
      ],
      "welcome": "天气变化让行程多了不确定，等消息也很耗神。我先陪您理清目前的情况。"
    },
    "en": {
      "title": "Weather disruption",
      "summary": "Weather at the airport or along the route is affecting normal operations. The flight is waiting for suitable conditions and operational arrangements.",
      "next": "The operations team will reassess conditions and update the departure time once new arrangements are confirmed.",
      "action": "Keep an eye on airport announcements and this page. An estimated time alone is not a reason to leave the waiting area.",
      "qa": [
        [
          "Why can other flights leave?",
          "Seeing other flights depart while you are still waiting can be frustrating. Conditions differ by route, aircraft and time, so this flight still needs its own clearance. Keep an eye on announcements for your flight and updates here."
        ],
        [
          "Could the delay get longer?",
          "It is hard to plan ahead without a firm time. Changing weather may affect the estimate again, so please follow the latest confirmed notice. If you have an urgent onward commitment, ground staff can hear the details."
        ]
      ],
      "welcome": "Weather changes can make an already disrupted journey feel uncertain. Let’s look at what is known, one step at a time."
    }
  },
  "TECHNICAL": {
    "minutes": 150,
    "zh": {
      "title": "飞机技术检查",
      "summary": "飞机需要额外技术检查，工程团队正在评估并处理相关问题。完成规定检查并获得放行后，才能继续安排起飞。",
      "next": "工程与运行团队会确认检查结果及后续安排；如需调整飞机，会在确认后另行通知。",
      "action": "请在候机区域等候最新通知。当前预计时间不代表技术检查已经完成。",
      "qa": [
        [
          "飞机安全吗？",
          "听到飞机需要检查，有顾虑是可以理解的。目前能确认的是，本航班需要完成额外技术检查；这条信息还不能说明具体故障或检查结果。规定检查完成并获得放行后，才会安排起飞。您也可以向现场工作人员询问已确认的进展。"
        ],
        [
          "会更换飞机吗？",
          "您可能会想，换一架飞机是不是能早点出发。是否需要更换，要由工程和运行团队评估；目前不能先替您确认。相关安排确定后，请留意后续通知。"
        ]
      ],
      "welcome": "听到飞机还需要检查，可能会让您担心。我先帮您把已确认的情况说清楚。"
    },
    "en": {
      "title": "Aircraft technical checks",
      "summary": "The aircraft needs additional technical checks. Engineers are assessing and addressing the issue; required checks and release must be completed before departure arrangements can proceed.",
      "next": "Engineering and operations teams will confirm the outcome and next arrangements. Any aircraft change will be announced after confirmation.",
      "action": "Wait for an update in the waiting area. The estimated time does not mean the technical checks are complete.",
      "qa": [
        [
          "Is the aircraft safe?",
          "It is understandable to have concerns when extra checks are needed. The confirmed information is that technical checks are required; it does not yet identify a specific fault or outcome. Required checks and release must be completed before departure is arranged. Ground staff can share any confirmed progress."
        ],
        [
          "Will the aircraft be changed?",
          "You may be wondering whether another aircraft could help you leave sooner. Engineering and operations teams need to assess that option, so I cannot confirm a change yet. Please watch for an announcement once an arrangement is confirmed."
        ]
      ],
      "welcome": "Hearing that the aircraft needs more checks may feel worrying. I can help you understand what has been confirmed so far."
    }
  },
  "LATE_AIRCRAFT": {
    "minutes": 60,
    "zh": {
      "title": "前序航班晚到",
      "summary": "执飞本航班的飞机受到前一段航程延误影响。飞机抵达后，仍需完成清洁、加油、配餐及登机准备。",
      "next": "运行团队会核实飞机抵达与过站准备进度，再确认登机及起飞安排。",
      "action": "请留意新的登机通知。飞机抵达机场不等于可以立即开始登机。",
      "qa": [
        [
          "飞机现在到哪里了？",
          "知道飞机到了哪里，会更容易安排接下来的等候。不过这里还没有可确认的实时位置，我不想给您一个猜测。您可以查看最新航班通知，或请地面工作人员核实抵达进展。"
        ],
        [
          "飞机到了就能马上登机吗？",
          "您盼着尽快登机的心情，我理解。飞机抵达后还需要完成清洁、加油等必要准备，所以不一定能马上登机。请留意确认后的登机通知，免得白跑一趟。"
        ]
      ],
      "welcome": "前一段航程的延误影响了您的安排，等候确实不容易。我们先看看飞机到达后还需要哪些准备。"
    },
    "en": {
      "title": "Late inbound aircraft",
      "summary": "The aircraft operating this flight has been delayed on its previous journey. After arrival it still needs turnaround tasks such as cleaning, refuelling, catering and boarding preparation.",
      "next": "The operations team will check arrival and turnaround progress before confirming boarding and departure arrangements.",
      "action": "Watch for a new boarding announcement. Aircraft arrival does not mean boarding can begin immediately.",
      "qa": [
        [
          "Where is the aircraft now?",
          "Knowing where the aircraft is would make the wait easier to plan. There is no confirmed live position here, and I do not want to give you a guess. The latest flight notice or ground staff may have a confirmed arrival update."
        ],
        [
          "Can we board as soon as it arrives?",
          "I understand you would like to get going. The aircraft still needs essential turnaround tasks, including cleaning and refuelling, so boarding may not start immediately. Please watch for the confirmed boarding announcement."
        ]
      ],
      "welcome": "A delay to the earlier flight has affected your plans too. Waiting is not easy; let’s look at what needs to happen after the aircraft arrives."
    }
  },
  "ATC": {
    "minutes": 45,
    "zh": {
      "title": "空中交通管制",
      "summary": "机场或航路正在实施流量管理，本航班需要等待新的运行时隙或起飞许可。",
      "next": "运行团队会与有关单位协调，在获得可执行的时隙后更新安排。",
      "action": "请保持关注登机广播；时隙可能调整，登机安排也可能随之变化。",
      "qa": [
        [
          "为什么还不能起飞？",
          "一直等着出发，确实让人挂心。机场或航路正在控制航班流量，本航班需要等待合适的运行时隙或起飞许可。安排确认后，请留意新的通知。"
        ],
        [
          "有了时隙就能准时走吗？",
          "您想要一个更确定的时间，是很自然的。有了时隙，还需要天气、飞机、机组和地面准备同时符合要求，因此目前还不能保证准时起飞。请以最新确认的安排为准。"
        ]
      ],
      "welcome": "已经准备出发，却还要等待许可，确实容易着急。我帮您把空管安排的意思说得简单一些。"
    },
    "en": {
      "title": "Air traffic control restrictions",
      "summary": "Traffic management at the airport or along the route means the flight must wait for an operating slot or departure clearance.",
      "next": "The operations team will coordinate with the relevant parties and update arrangements when a usable slot is confirmed.",
      "action": "Keep watching boarding announcements. Slot changes can also affect boarding arrangements.",
      "qa": [
        [
          "Why can we not depart yet?",
          "Waiting to get going can be wearing. Traffic management at the airport or along the route means this flight needs a suitable slot or departure clearance. Please watch for an update once an arrangement is confirmed."
        ],
        [
          "Does a slot mean we will leave on time?",
          "It makes sense to want a firmer time. A slot is one part of the plan; weather, aircraft, crew and ground preparations must also be ready. An on-time departure cannot yet be guaranteed, so please follow the latest confirmed arrangement."
        ]
      ],
      "welcome": "Having to wait for clearance when you are ready to travel can be frustrating. I can explain the traffic-control arrangements in plain language."
    }
  },
  "CREW": {
    "minutes": 120,
    "zh": {
      "title": "机组调配",
      "summary": "机组安排需要调整，以满足执勤时间及安全运行要求。相关团队正在协调后续执飞安排。",
      "next": "在机组及相关准备确认后，运行团队会更新登机与起飞时间。",
      "action": "请等候确认后的通知，暂勿把预计时间视为机组已全部就位。",
      "qa": [
        [
          "为什么机组安排会影响航班？",
          "这个原因可能不太直观。机组需要符合执勤时间和安全运行要求，有时因此需要调整或替换。我们先以确认后的安排为准；如果您有需要尽早说明的行程，可以向地面工作人员提出。"
        ],
        [
          "替换机组已经到了吗？",
          "我知道您希望尽快看到明确的进展。目前这条消息还没有确认替换机组的位置或抵达时间，我不能替您猜测。您可以请现场工作人员核实已经确认的安排。"
        ]
      ],
      "welcome": "机组调配听起来有些抽象，行程被耽搁也让人费心。我来帮您说明目前这条消息。"
    },
    "en": {
      "title": "Crew arrangements",
      "summary": "Crew arrangements need to change to meet duty-time and safe-operation requirements. Teams are coordinating the next operating plan.",
      "next": "Boarding and departure times will be updated once crew arrangements and related preparations are confirmed.",
      "action": "Wait for a confirmed update. An estimated time does not mean the full crew is in position.",
      "qa": [
        [
          "Why can crew arrangements delay a flight?",
          "This may not be an obvious reason for a delay. Crew need to meet duty-time and safe-operation requirements, which can mean a change or replacement. Please follow confirmed arrangements, and let ground staff know if you have an urgent travel concern."
        ],
        [
          "Has a replacement crew arrived?",
          "I know a clear sign of progress would help. This notice does not yet confirm a replacement crew’s location or arrival time, and I do not want to guess. Ground staff can check any confirmed arrangements for you."
        ]
      ],
      "welcome": "Crew arrangements can sound rather abstract when your own plans are on hold. Let me help make the current notice clearer."
    }
  },
  "OPERATIONAL": {
    "minutes": 75,
    "zh": {
      "title": "地面及运行保障",
      "summary": "航班的地面保障或机场运行安排需要进一步协调，例如登机口、行李或地面设备。",
      "next": "运行与外站团队会逐项确认资源，完成协调后更新登机及起飞安排。",
      "action": "请按最新公布的登机口和通知行动；如登机口正在重新确认，请勿沿用旧位置。",
      "qa": [
        [
          "“运行原因”具体是什么？",
          "这个说法确实不够直观。它可能涉及登机口、行李或地面设备等资源的协调，具体是哪一项，还需要以本航班确认的通知为准。您可以请现场工作人员说明正在等待确认的事项。"
        ],
        [
          "登机口会变吗？",
          "您可能担心错过通知、走错地方。目前不能排除调整登机口的可能。如果位置有变化，请以最新确认的位置为准；暂时不确定时，可以先向附近工作人员核实。"
        ]
      ],
      "welcome": "“运行原因”这个说法有些笼统，也可能让您更没底。我帮您拆开说明，再看看接下来能做什么。"
    },
    "en": {
      "title": "Ground and operational arrangements",
      "summary": "Ground handling or airport arrangements need further coordination, such as a gate, baggage handling or ground equipment.",
      "next": "Operations and station teams will confirm resources before updating boarding and departure arrangements.",
      "action": "Use the latest published gate and instructions. If a gate is being reconfirmed, do not rely on the old location.",
      "qa": [
        [
          "What does “operational” mean?",
          "The phrase is not very specific. It can involve coordination of gates, baggage or ground equipment; the particular issue still needs to come from a confirmed notice for this flight. You can ask ground staff which arrangement is awaiting confirmation."
        ],
        [
          "Could the gate change?",
          "You may be worried about missing an announcement or going to the wrong place. A gate change is possible, but any new location needs confirmation. If you are unsure which notice is current, a nearby member of staff can help check."
        ]
      ],
      "welcome": "“Operational reasons” is a broad phrase, and that can make the wait feel less certain. I can help unpack it and look at what you can do next."
    }
  }
};
export const COMMON_PASSENGER_QA = {
  "zh": [
    [
      "可以领取餐券或补偿吗？",
      "等候久了，吃饭和休息都很重要。具体有哪些协助，需要航空公司按本次延误的实际安排确认。您可以向地面工作人员或官方客服询问；我这里还不能替您确认餐券或补偿。"
    ],
    [
      "可以改签或退款吗？",
      "行程受到影响，要重新安排确实很费心。您可以通过航空公司官方客服或预订管理，查询这次航班适用的退改选项。我可以帮您理清现有消息，但不能在这里替您提交改签或退款。"
    ]
  ],
  "en": [
    [
      "Are meals or compensation provided?",
      "Waiting can make it hard to plan meals and rest. Ground staff or official support can check which assistance applies to this disruption. I cannot confirm vouchers or compensation here."
    ],
    [
      "Can I change my flight or get a refund?",
      "Rearranging a disrupted trip can be a lot to deal with. Official support or booking management can check the options that apply to your flight. I can help explain the information here, but cannot submit a change or refund for you."
    ]
  ]
};
const BRIEFS = {
  WEATHER:{zh:'天气影响起降，正在等待适合的运行条件。',en:'Weather is affecting operations. The flight is waiting for suitable conditions.'},
  TECHNICAL:{zh:'飞机需要额外技术检查，完成检查并放行后才能安排起飞。',en:'Additional aircraft checks and release are required before departure can be arranged.'},
  LATE_AIRCRAFT:{zh:'执飞飞机前序晚到，抵达后仍需完成必要的过站准备。',en:'The inbound aircraft is late. Required turnaround tasks must follow its arrival.'},
  ATC:{zh:'受空中交通管制影响，正在等待运行时隙或起飞许可。',en:'Air traffic restrictions mean waiting for a slot or departure clearance.'},
  CREW:{zh:'正在调整机组安排，以满足执勤与安全运行要求。',en:'Crew arrangements are being adjusted to meet duty and operating requirements.'},
  OPERATIONAL:{zh:'正在协调登机口、行李或地面设备等运行保障资源。',en:'Teams are coordinating ground resources such as gates, baggage or equipment.'}
};
export function scenarioCopy(code, language) {
  const lang=language==='zh'?'zh':'en';
  return Object.hasOwn(DELAY_SCENARIOS,code) ? {...DELAY_SCENARIOS[code][lang],brief:BRIEFS[code][lang]} : undefined;
}
export function scenarioStatus(actual, code) {
  const scenario = Object.hasOwn(DELAY_SCENARIOS,code) ? DELAY_SCENARIOS[code] : null;
  if (!scenario) return actual;
  return {...actual, status:'DELAYED',cause:code,departure:new Date(new Date(actual.scheduled).getTime()+scenario.minutes*60000).toISOString()};
}
export function scenarioNotice(flight, code, departure, language) {
  const copy = scenarioCopy(code,language);
  const time = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN':'en-GB',{timeZone:'Asia/Hong_Kong',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(departure));
  return language === 'zh' ? `航班 ${flight} 因${copy.title}延误，预计于香港时间 ${time} 起飞。${copy.action}`
    : `Flight ${flight} is delayed due to ${copy.title.toLowerCase()}. Estimated departure is ${time} HKT. ${copy.action}`;
}
