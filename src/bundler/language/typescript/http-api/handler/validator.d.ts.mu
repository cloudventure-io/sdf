import { Validator } from "@cloudventure/sdf/http-api/runtime";

{{ #Validators }}
declare const {{ $id }}: Validator;
export { {{ $id }} };
{{ /Validators }}
