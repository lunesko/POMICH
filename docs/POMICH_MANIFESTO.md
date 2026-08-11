# POMICH Manifesto

## POMICH — допомога вже їде.

A car can stop at any moment. A dead battery, flat tire, empty fuel tank, mechanical failure, or accident can turn an ordinary trip into a situation where a person is suddenly alone on the road.

Today, finding help often means opening Google, calling several numbers, explaining where you are, waiting for answers, negotiating the price, waiting again, and hoping the provider actually arrives.

We believe roadside help should be as simple to request as a taxi.

That is POMICH.

## What We Are Building

POMICH is an on-demand network for roadside assistance.

It is not a towing directory.
It is not a bulletin board.
It is not another navigator.
It is not a service that needs to own a fleet of vehicles.

POMICH is a technology platform that connects a driver in trouble with the right nearby provider at the moment of need.

The customer flow should be simple:

```text
open POMICH
  -> choose the problem
  -> confirm location
  -> see conditions
  -> request help
```

After that, the system handles the rest:

```text
Problem
  -> geolocation
  -> POMICH dispatch
  -> suitable providers nearby
  -> first provider accepts
  -> provider assigned
  -> help is on the way
  -> arrival
  -> work completed
```

The person should not have to search for help.

Help should find the person.

## Mission

Make roadside help fast, transparent, and predictable anywhere there is a vehicle and a capable provider.

We want the phrase "my car broke down" to stop meaning "now I need to find someone to call."

It should mean:

**I opened POMICH. Help is already on the way.**

## Product Shape

POMICH should become for roadside assistance what Uber, Bolt, and Uklon became for city rides.

The mechanics are reversed.

In ride-hailing:

```text
driver arrives
  -> picks up the person
  -> drives them somewhere
```

In POMICH:

```text
provider arrives
  -> reaches the broken vehicle
  -> solves the problem
```

Behind one POMICH button, there should eventually be a full network:

- towing
- battery jump-start
- wheel help
- fuel delivery
- vehicle lockout help
- mobile mechanics

The customer reports what happened.

POMICH decides who to send.

## Dispatch Principle

Not the nearest provider. The best provider for the situation.

Distance is only one factor. Real dispatch should consider:

```text
problem type
+ provider capabilities
+ provider location
+ availability
+ ETA
+ acceptance probability
+ completion history
+ current load
= best provider
```

This dispatch mechanism should become one of POMICH's core technology assets.

The key metric is **Time To Rescue**:

```text
time from order creation
to real provider arrival
```

Every release should answer one question: does it reduce Time To Rescue or increase trust that rescue will actually happen?

## Map Is Not The Product

POMICH does not compete with Google Maps, Waze, or other navigation products.

They answer:

**How do I get there?**

POMICH answers:

**Who should be sent when the car can no longer go?**

The map is an interface to infrastructure, not the product itself.

At the start, POMICH uses OpenStreetMap and its own dispatch layer. Later it should integrate with Google Maps, Waze, Android Automotive, insurers, OEM apps, fleet systems, and telematics.

Simple formula:

**Google knows how to drive. POMICH knows who to send.**

## One Product For The Customer

The core experience is one mobile-first Web/PWA:

```text
pomich.help
```

The same frontend should open through:

```text
Browser -> POMICH PWA
Telegram -> POMICH Mini App
Later -> native / automotive integrations
```

The user should get the same experience regardless of entry point.

## POMICH Partner

The second half of the product is providers.

Many towing operators and mobile mechanics today get customers through phone calls, classifieds, Telegram groups, Google, and recommendations. POMICH should give them a next-generation work tool.

Provider flow:

```text
POMICH Partner
  -> off duty
  -> go online
```

When a suitable nearby order appears:

```text
New order
Tow
3.8 km
Volvo V60

[Accept]
```

The first suitable provider who accepts gets the order. POMICH then tracks the lifecycle:

```text
ASSIGNED
  -> EN_ROUTE
  -> ARRIVED
  -> IN_PROGRESS
  -> COMPLETED
```

This turns fragmented providers into a single digital roadside assistance network.

## Asset-Light Network

POMICH should not own thousands of tow trucks.

The market already has towing operators, service stations, mobile mechanics, tire services, insurers, assistance companies, and independent providers.

The problem is not lack of providers.

The problem is lack of a unified system for instant access to them.

POMICH builds that system.

## First Ukraine, Then Beyond

Ukraine is the first market and product proving ground.

The first proof is not a presentation or a beautiful demo. It is real orders.

```text
1 city
  -> 10 providers
  -> 100 real orders
  -> 1000 orders
  -> several cities
  -> all Ukraine
```

After that, the model can be exported to other countries.

## OpenRoadAid

POMICH can develop alongside a second layer:

- **POMICH**: product and marketplace
- **OpenRoadAid**: protocol and infrastructure layer

```text
OpenRoadAid
  -> incident
  -> capabilities
  -> matching
  -> offer
  -> assignment
  -> arrival
  -> completion
```

OpenRoadAid can become a shared language for integrations from maps, vehicles, insurers, fleet systems, banks, OEM apps, and telematics.

## Long-Term Asset

The long-term value is not React, FastAPI, or UI design. Those can be copied.

The real asset should become:

```text
verified provider network
+ historical incidents
+ provider reputation
+ real TTR data
+ dispatch engine
+ demand map
+ supply map
+ pricing intelligence
+ integrations
```

Every completed order should make the network smarter.

## Principles

- Help first, features second.
- Reality matters more than demo polish.
- The user should not need to understand the market.
- Price should be clear before help arrives.
- Providers must see platform value.
- Navigation should not be reinvented.
- Safety and trust are part of the product.
- The architecture must be able to become an API.

## One-Sentence Definition

**POMICH is a technology network that turns a roadside vehicle problem into automatically assigned and tracked help from a suitable nearby provider.**

For the customer:

**POMICH — допомога вже їде.**

For strategic partners:

**POMICH turns roadside incidents into real-world assistance.**

