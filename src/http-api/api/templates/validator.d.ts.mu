import { Validator } from "@cloudventure/sdf";

{{ #Validators }}
declare const {{ $id }}: Validator;
export { {{ $id }} };
{{ /Validators }}
