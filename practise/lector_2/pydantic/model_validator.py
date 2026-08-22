from pydantic import BaseModel, EmailStr, AnyUrl, model_validator
from typing import Dict, List, Optional

class Info(BaseModel):
    name: str
    contact : Contact
    website : AnyUrl
    weight: Optional[float]
    age: int 
    subjects : List[str]
    marks : Dict[str , int]

    @model_validator(mode="after")
    def emergency_email(cls, model):
        if model.age>60 and "emergency" not in model.email:
            raise ValueError ("Should have an emergency email")
        return model



info = {
    "name" : "Parmeet",
    "contact" : {"email":"granthi.parmeet@gmail.io", "emergency":"abc@gmail.com"},
    "age" : 87,
    "website" : "http://parmeetsingh.com",
    "weight": 89.32,
    "subjects" : ["math", "physics", "chemistry"],
    "marks" : {"math": 73, "physics" : 53, "chemistry":"83"}
}

info_un = Info(**info)

print(info_un.name)
print(info_un.email)
print(info_un.age)
print(info_un.website)
print(info_un.subjects)
print(info_un.marks)
print(info_un.weight)