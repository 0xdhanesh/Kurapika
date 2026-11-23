export const examples = [
  {
    name: 'Service architecture',
    file: 'architecture.mmd',
    source: `flowchart TD
    %% Entry point
    client([Web Client])
    gateway[API Gateway]

    %% Application services
    auth[Auth Service]
    api[Application API]

    %% Storage layer
    cache[(Session Cache)]
    db[(Primary Database)]

    client -->|HTTPS| gateway
    gateway --> auth
    gateway --> api
    auth --> cache
    api --> db

    class client,gateway entry
    class auth,api service
    class cache,db storage`
  },
  {
    name: 'Access decision',
    file: 'access.mmd',
    source: `flowchart TD
    request([Access request]) --> identity{Valid identity?}
    identity -->|Yes| policy{Policy allows?}
    identity -->|No| deny[Reject request]
    policy -->|Yes| allow[Grant access]
    policy -->|No| deny
    class request entry
    class identity,policy service
    class allow,deny storage`
  },
  {
    name: 'Request sequence',
    file: 'request.mmd',
    source: `sequenceDiagram
    participant Client
    participant Gateway
    participant Service
    Client->>Gateway: HTTPS request
    Gateway->>Service: Forward request
    Service-->>Gateway: Result
    Gateway-->>Client: Response`
  }
]
